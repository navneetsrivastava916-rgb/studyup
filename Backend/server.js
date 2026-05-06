const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// DB Connect
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/studyup')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.log('❌ DB Error:', err));

// ─── SCHEMAS ───────────────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '' },
  targetYear: { type: Number, default: 2027 },
  examDate: { type: Date, default: new Date('2027-01-15') },
  rank: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const progressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  studyTime: { type: Number, default: 0 }, // minutes
  tasksCompleted: { type: Number, default: 0 },
  tasksTotal: { type: Number, default: 0 },
  successRate: { type: Number, default: 0 }, // percentage
  subjects: [{
    name: String,
    minutes: Number,
    chapters: [String]
  }]
}, { timestamps: true });

const taskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  subject: { type: String, enum: ['Physics', 'Chemistry', 'Mathematics'], required: true },
  chapter: { type: String, default: '' },
  priority: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium' },
  importance: { type: String, enum: ['Critical', 'Important', 'Normal'], default: 'Normal' },
  timeRequired: { type: Number, default: 60 }, // minutes
  dueDate: { type: Date },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date },
  notes: { type: String, default: '' }
}, { timestamps: true });

const scheduleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  week: { type: String, required: true }, // YYYY-WW
  slots: [{
    day: { type: String, enum: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
    startTime: String,
    endTime: String,
    subject: String,
    chapter: String,
    type: { type: String, enum: ['Study','Revision','Practice','Break'], default: 'Study' }
  }],
  totalHoursPlanned: { type: Number, default: 0 }
}, { timestamps: true });

const achievementSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: String,
  icon: { type: String, default: '🏆' },
  type: { type: String, enum: ['streak','completion','time','rank','special'], default: 'completion' },
  earnedAt: { type: Date, default: Date.now },
  xp: { type: Number, default: 10 }
});

const chatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

// Models
const User = mongoose.model('User', userSchema);
const Progress = mongoose.model('Progress', progressSchema);
const Task = mongoose.model('Task', taskSchema);
const Schedule = mongoose.model('Schedule', scheduleSchema);
const Achievement = mongoose.model('Achievement', achievementSchema);
const Chat = mongoose.model('Chat', chatSchema);

// ─── AUTH MIDDLEWARE ────────────────────────────────────────────────────────────

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'studyup_secret');
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ─── AUTH ROUTES ────────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, password: hashed });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'studyup_secret', { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'studyup_secret', { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, rank: user.rank } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PROGRESS ROUTES ────────────────────────────────────────────────────────────

app.get('/api/progress/today', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    let progress = await Progress.findOne({ userId: req.userId, date: today });
    if (!progress) {
      progress = await Progress.create({ userId: req.userId, date: today, studyTime: 0, tasksCompleted: 0, tasksTotal: 0 });
    }
    res.json(progress);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/progress/today', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const update = req.body;
    const progress = await Progress.findOneAndUpdate(
      { userId: req.userId, date: today },
      { $set: update },
      { upsert: true, new: true }
    );
    // Emit real-time update
    io.to(req.userId.toString()).emit('progress_update', progress);
    res.json(progress);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/progress/history', auth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const history = await Progress.find({ userId: req.userId })
      .sort({ date: -1 }).limit(days);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/progress/stats', auth, async (req, res) => {
  try {
    const history = await Progress.find({ userId: req.userId }).sort({ date: -1 }).limit(30);
    const totalStudyTime = history.reduce((s, p) => s + (p.studyTime || 0), 0);
    const totalTasks = history.reduce((s, p) => s + (p.tasksCompleted || 0), 0);
    const avgSuccess = history.length
      ? history.reduce((s, p) => s + (p.successRate || 0), 0) / history.length
      : 0;
    // Days left to JEE 2027
    const examDate = new Date('2027-01-15');
    const today = new Date();
    const daysLeft = Math.ceil((examDate - today) / (1000 * 60 * 60 * 24));
    res.json({ totalStudyTime, totalTasks, avgSuccess: Math.round(avgSuccess), daysLeft, streak: history.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TASK ROUTES ────────────────────────────────────────────────────────────────

app.get('/api/tasks', auth, async (req, res) => {
  try {
    const { date, subject, completed } = req.query;
    let query = { userId: req.userId };
    if (subject) query.subject = subject;
    if (completed !== undefined) query.completed = completed === 'true';
    if (date) {
      const d = new Date(date);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      query.dueDate = { $gte: d, $lt: next };
    }
    const tasks = await Task.find(query).sort({ priority: 1, createdAt: -1 });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', auth, async (req, res) => {
  try {
    const task = await Task.create({ ...req.body, userId: req.userId });
    io.to(req.userId.toString()).emit('task_added', task);
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id', auth, async (req, res) => {
  try {
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: req.body },
      { new: true }
    );
    if (req.body.completed) {
      // Update today's progress
      const today = new Date().toISOString().split('T')[0];
      await Progress.findOneAndUpdate(
        { userId: req.userId, date: today },
        { $inc: { tasksCompleted: 1 } },
        { upsert: true }
      );
      // Check achievements
      const completedCount = await Task.countDocuments({ userId: req.userId, completed: true });
      if ([1, 5, 10, 25, 50, 100].includes(completedCount)) {
        const ach = await Achievement.create({
          userId: req.userId,
          title: `${completedCount} Tasks Completed!`,
          description: `You have completed ${completedCount} study tasks`,
          icon: completedCount >= 50 ? '🏆' : completedCount >= 10 ? '⭐' : '✅',
          type: 'completion',
          xp: completedCount * 5
        });
        io.to(req.userId.toString()).emit('achievement_unlocked', ach);
      }
    }
    io.to(req.userId.toString()).emit('task_updated', task);
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', auth, async (req, res) => {
  try {
    await Task.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SCHEDULE ROUTES ────────────────────────────────────────────────────────────

app.get('/api/schedule', auth, async (req, res) => {
  try {
    const week = req.query.week || getCurrentWeek();
    let schedule = await Schedule.findOne({ userId: req.userId, week });
    if (!schedule) schedule = { slots: [], totalHoursPlanned: 0 };
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/schedule', auth, async (req, res) => {
  try {
    const { week, slots } = req.body;
    const totalMins = slots.reduce((s, slot) => {
      if (slot.startTime && slot.endTime) {
        const [sh, sm] = slot.startTime.split(':').map(Number);
        const [eh, em] = slot.endTime.split(':').map(Number);
        return s + (eh * 60 + em) - (sh * 60 + sm);
      }
      return s;
    }, 0);
    const schedule = await Schedule.findOneAndUpdate(
      { userId: req.userId, week: week || getCurrentWeek() },
      { $set: { slots, totalHoursPlanned: Math.round(totalMins / 60) } },
      { upsert: true, new: true }
    );
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ACHIEVEMENT ROUTES ─────────────────────────────────────────────────────────

app.get('/api/achievements', auth, async (req, res) => {
  try {
    const achievements = await Achievement.find({ userId: req.userId }).sort({ earnedAt: -1 });
    res.json(achievements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LEADERBOARD ────────────────────────────────────────────────────────────────

app.get('/api/leaderboard', auth, async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const pipeline = [
      { $match: { date: { $gte: thirtyDaysAgo.toISOString().split('T')[0] } } },
      { $group: { _id: '$userId', totalStudyTime: { $sum: '$studyTime' }, tasksCompleted: { $sum: '$tasksCompleted' }, avgSuccess: { $avg: '$successRate' } } },
      { $sort: { totalStudyTime: -1 } },
      { $limit: 20 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { name: '$user.name', totalStudyTime: 1, tasksCompleted: 1, avgSuccess: 1 } }
    ];
    const leaderboard = await Progress.aggregate(pipeline);
    res.json(leaderboard.map((u, i) => ({ ...u, rank: i + 1 })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI CHATBOT ROUTE ────────────────────────────────────────────────────────────

app.post('/api/chat', auth, async (req, res) => {
  try {
    const { message } = req.body;
    const user = await User.findById(req.userId).select('-password');
    const today = new Date().toISOString().split('T')[0];
    const todayProgress = await Progress.findOne({ userId: req.userId, date: today });
    const pendingTasks = await Task.find({ userId: req.userId, completed: false }).limit(5);
    const recentChats = await Chat.find({ userId: req.userId }).sort({ timestamp: -1 }).limit(10);

    // Exam days left
    const daysLeft = Math.ceil((new Date('2027-01-15') - new Date()) / (1000 * 60 * 60 * 24));

    const systemPrompt = `You are StudyBot, an expert AI study assistant for ${user.name} who is preparing for JEE Mains & Advanced 2027.

Current Status:
- Days left to JEE 2027: ${daysLeft}
- Today's study time: ${todayProgress?.studyTime || 0} minutes
- Today's tasks completed: ${todayProgress?.tasksCompleted || 0}/${todayProgress?.tasksTotal || 0}
- Success rate: ${todayProgress?.successRate || 0}%
- Pending tasks: ${pendingTasks.map(t => `${t.subject}: ${t.title}`).join(', ') || 'None'}

Your capabilities:
1. Help manage study time and create study plans
2. Suggest which lectures/chapters to complete first
3. Answer doubts in Physics, Chemistry, Mathematics (JEE level)
4. Track and analyze progress
5. Motivate and guide the student
6. Provide chapter-wise strategies for JEE

Keep responses concise, motivating, and JEE-focused. Use bullet points when listing steps. Be friendly and encouraging.`;

    // Save user message
    await Chat.create({ userId: req.userId, role: 'user', content: message });

    // Build conversation history
    const history = recentChats.reverse().map(c => ({ role: c.role, content: c.content }));
    history.push({ role: 'user', content: message });

    // Call Claude API
    const apiKey = process.env.CLAUDE_API_KEY;
    let assistantReply = '';

    if (apiKey && apiKey !== 'your_anthropic_api_key_here') {
      const axios = require('axios');
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: history
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }
      });
      assistantReply = response.data.content[0].text;
    } else {
      // Fallback smart responses without API key
      assistantReply = getSmartFallback(message, daysLeft, todayProgress, pendingTasks);
    }

    // Save assistant reply
    await Chat.create({ userId: req.userId, role: 'assistant', content: assistantReply });

    res.json({ reply: assistantReply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Chat failed: ' + err.message });
  }
});

function getSmartFallback(message, daysLeft, progress, tasks) {
  const msg = message.toLowerCase();
  if (msg.includes('plan') || msg.includes('schedule') || msg.includes('timetable')) {
    return `📅 **Recommended Daily Plan for JEE 2027** (${daysLeft} days left)\n\n• 6:00–8:00 AM → Mathematics (2 hrs)\n• 8:30–10:30 AM → Physics (2 hrs)\n• 11:00 AM–1:00 PM → Chemistry (2 hrs)\n• 2:00–4:00 PM → Revision + PYQs (2 hrs)\n• 4:30–6:00 PM → Mock Test / Practice (1.5 hrs)\n• 7:00–9:00 PM → Doubt Solving (2 hrs)\n\nTarget: **11–12 hrs/day** for JEE Advanced level.`;
  }
  if (msg.includes('motivat') || msg.includes('tired') || msg.includes('give up')) {
    return `💪 **You've got this!**\n\nEvery JEE topper felt exactly like this. The difference is they pushed through.\n\n• ${daysLeft} days is ENOUGH if you use them wisely\n• One good chapter today = one step closer to IIT\n• Your future self is counting on TODAY's you\n\nGet up, drink water, and open that book. You're not tired — you're growing. 🚀`;
  }
  if (msg.includes('physics') || msg.includes('mechanic') || msg.includes('electro')) {
    return `⚡ **Physics Strategy for JEE**\n\n**High Priority Chapters:**\n• Mechanics (20-25% weightage)\n• Electrostatics & Current Electricity\n• Waves & Optics\n• Modern Physics\n\n**Tips:**\n• Solve HC Verma + DC Pandey\n• Focus on concept-based problems\n• Do last 10 years PYQs chapter-wise\n• Practice numerical daily`;
  }
  if (msg.includes('chemistry') || msg.includes('organic') || msg.includes('inorganic')) {
    return `🧪 **Chemistry Strategy for JEE**\n\n**High Scoring Areas:**\n• Organic Chemistry (named reactions, mechanisms)\n• Coordination Chemistry\n• Chemical Equilibrium\n• Electrochemistry\n\n**Tips:**\n• NCERT is Bible for Inorganic\n• Make reaction charts for Organic\n• Solve 30 MCQs daily\n• Revision every Sunday`;
  }
  if (msg.includes('math') || msg.includes('calculus') || msg.includes('algebra')) {
    return `📐 **Mathematics Strategy for JEE**\n\n**Most Important Topics:**\n• Calculus (35% weightage)\n• Algebra (Quadratic, Complex Numbers, Matrices)\n• Coordinate Geometry\n• Probability & Statistics\n\n**Tips:**\n• Practice 20 problems daily minimum\n• Focus on speed + accuracy\n• RD Sharma → Cengage → PYQs\n• Don't skip Integration`;
  }
  if (msg.includes('progress') || msg.includes('track') || msg.includes('how am i')) {
    return `📊 **Your Progress Today:**\n\n• Study Time: ${progress?.studyTime || 0} mins\n• Tasks Done: ${progress?.tasksCompleted || 0}\n• Success Rate: ${progress?.successRate || 0}%\n\n${(progress?.studyTime || 0) < 360 ? '⚠️ Target at least 6 hrs today!' : '✅ Good progress! Keep it up!'}\n\nPending: ${tasks.length} task(s) remaining. Focus on high-priority ones first.`;
  }
  return `🤖 **StudyBot here!**\n\nI'm your JEE 2027 study assistant. I can help you with:\n\n• 📅 Creating study plans & timetables\n• 📚 Subject strategies (Physics/Chemistry/Math)\n• 💪 Motivation when you feel low\n• 📊 Tracking your progress\n• ❓ Answering subject doubts\n\nYou have **${daysLeft} days** until JEE 2027. Ask me anything!`;
}

function getCurrentWeek() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ─── SOCKET.IO ──────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined room`);
  });

  socket.on('study_session_start', async ({ userId, subject }) => {
    socket.to(userId).emit('study_started', { subject, time: Date.now() });
  });

  socket.on('study_session_end', async ({ userId, minutes }) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      await Progress.findOneAndUpdate(
        { userId, date: today },
        { $inc: { studyTime: minutes } },
        { upsert: true }
      );
      io.to(userId).emit('study_time_updated', { minutes });
    } catch (err) { console.error(err); }
  });

  socket.on('disconnect', () => console.log('Socket disconnected:', socket.id));
});

// ─── SERVE FRONTEND ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n🚀 StudyUp Server running on http://localhost:${PORT}`);
  console.log(`📚 JEE 2027 Prep System - Ready!\n`);
});