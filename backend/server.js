const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express'), cors = require('cors'), mongoose = require('mongoose'), helmet = require('helmet');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), rateLimit = require('express-rate-limit');

const missing = ['JWT_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH'].filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing required environment variables: ' + missing.join(', ') + '. Copy backend/.env.example to backend/.env and fill them in.');
  process.exit(1);
}

const app = express();
// Behind a hosting proxy (Render, Railway, Nginx...) so rate limiting sees real client IPs
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Express 4 does not catch errors thrown inside async route handlers, which
// left requests hanging (or crashed the server). Wrap every async handler so
// errors reach the error middleware at the bottom instead.
['get', 'post', 'patch', 'put', 'delete'].forEach(m => {
  const orig = app[m].bind(app);
  app[m] = (route, ...handlers) => orig(route, ...handlers.map(h =>
    (typeof h === 'function' && h.constructor.name === 'AsyncFunction')
      ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)
      : h));
});

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many attempts. Try again later.' } });

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/durabon')
  .then(() => console.log('MongoDB connected'))
  .catch(e => console.log('MongoDB error:', e.message));

// ---------- Schemas ----------
const classAssignmentSchema = new mongoose.Schema({ className: String, subject: String }, { _id: false });

const studentSchema = new mongoose.Schema({
  name: String,
  studentId: { type: String, unique: true },
  className: String,
  gender: { type: String, enum: ['Male', 'Female'] },
  admissionNo: String,
  password: String,          // bcrypt hash
  initialPassword: String,   // shown once to admin, never used for login after change
  status: { type: String, enum: ['active', 'suspended'], default: 'active' }
}, { timestamps: true });

const teacherSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  teacherId: { type: String, unique: true },
  password: String,          // bcrypt hash
  initialPassword: String,   // shown once to admin
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  assignedClasses: [classAssignmentSchema],
  classTeacherOf: [String]   // classNames this teacher is the homeroom/class teacher for
}, { timestamps: true });

const scoreSchema = new mongoose.Schema({
  studentId: String, studentName: String, subject: String, className: String,
  term: String, session: String, ca1: Number, ca2: Number, exam: Number, total: Number, teacherId: String
}, { timestamps: true });

const settingsSchema = new mongoose.Schema({ key: { type: String, unique: true }, resultPortalOpen: Boolean, teacherPortalOpen: Boolean });

// Affective / psychomotor ratings, attendance and comments — one document
// per student per term per session. Ratings are '1'..'5' or 'N/A' (strings,
// to match how they're displayed on the report).
const remarkSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  term: String, session: String,
  affective: {
    attendance: String, honesty: String, leadership: String,
    neatness: String, perseverance: String, sociability: String
  },
  psychomotor: {
    agility: String, communication: String, games: String,
    handlingOfTools: String, sports: String
  },
  timesSchoolOpened: Number,
  timesPresent: Number,
  nextTermBegins: String,
  classTeacherComment: String,
  principalComment: String
}, { timestamps: true });
remarkSchema.index({ studentId: 1, term: 1, session: 1 }, { unique: true });

const Student = mongoose.model('Student', studentSchema);
const Teacher = mongoose.model('Teacher', teacherSchema);
const Score = mongoose.model('Score', scoreSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const messageSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null }, // null = sent to every teacher
  teacherName: String,   // denormalized so the admin's sent log survives a deleted teacher
  subject: String,
  body: String
}, { timestamps: true });

const Remark = mongoose.model('Remark', remarkSchema);
const Message = mongoose.model('Message', messageSchema);

const CURRENT_SESSION = '2026/2027';
const TERMS = ['1st Term', '2nd Term', '3rd Term'];

// ---------- Helpers ----------
function genId(prefix, n) { return prefix + '-' + new Date().getFullYear() + '-' + String(n).padStart(4, '0'); }
function genPassword() { return Math.random().toString(36).slice(2, 6).toUpperCase() + Math.floor(1000 + Math.random() * 9000); }
async function nextId(Model, prefix) { const count = await Model.countDocuments(); return genId(prefix, count + 1); }
async function getSettings() { let s = await Settings.findOne({ key: 'portal' }); if (!s) s = await Settings.create({ key: 'portal', resultPortalOpen: true, teacherPortalOpen: true }); return s; }
const cleanId = v => String(v || '').trim().toUpperCase();
async function passwordMatches(plain, hash) {
  plain = String(plain || '');
  return (await bcrypt.compare(plain, hash)) || (plain !== plain.trim() && await bcrypt.compare(plain.trim(), hash));
}
function sign(payload) { return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' }); }

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
// Standard competition ranking (ties share a rank; the rank skips
// accordingly): [{id,value}] sorted desc by value -> { id: "1st" }
function rankPositions(list) {
  const sorted = [...list].sort((a, b) => b.value - a.value);
  const positions = {};
  let lastValue = null, lastRank = 0;
  sorted.forEach((item, idx) => {
    if (item.value !== lastValue) { lastRank = idx + 1; lastValue = item.value; }
    positions[item.id] = ordinal(lastRank);
  });
  return positions;
}

function auth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Authentication required.' });
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (role && payload.role !== role) return res.status(403).json({ message: 'Forbidden.' });
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ message: 'Invalid or expired session. Please log in again.' });
    }
  };
}

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'DURABON Academy' }));

// ---------- Auth ----------
app.post('/api/auth/admin-login', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (username !== process.env.ADMIN_USERNAME) return res.status(401).json({ message: 'Invalid admin credentials.' });
  const ok = await bcrypt.compare(password || '', process.env.ADMIN_PASSWORD_HASH || '');
  if (!ok) return res.status(401).json({ message: 'Invalid admin credentials.' });
  res.json({ ok: true, token: sign({ role: 'admin' }) });
});

app.post('/api/auth/teacher-login', authLimiter, async (req, res) => {
  const { password } = req.body;
  const t = await Teacher.findOne({ teacherId: cleanId(req.body.teacherId) });
  if (!t || !(await passwordMatches(password, t.password))) return res.status(401).json({ message: 'Invalid Teacher ID or password.' });
  if (t.status === 'suspended') return res.status(403).json({ message: 'This teacher account has been suspended. Contact the school administrator.' });
  const set = await getSettings();
  if (!set.teacherPortalOpen) return res.status(403).json({ message: 'Teacher portal is currently closed.' });
  res.json({
    token: sign({ id: t._id, teacherId: t.teacherId, role: 'teacher' }),
    teacher: { _id: t._id, name: t.name, teacherId: t.teacherId, assignedClasses: t.assignedClasses }
  });
});

app.post('/api/auth/student-login', authLimiter, async (req, res) => {
  const { password } = req.body;
  const className = String(req.body.className || '').trim();
  const s = await Student.findOne({ studentId: cleanId(req.body.studentId) });
  if (!s || !(await passwordMatches(password, s.password))) return res.status(401).json({ message: 'Invalid Student ID or password.' });
  if (className && s.className !== className) return res.status(401).json({ message: 'Selected class does not match the class on your student record.' });
  if (s.status === 'suspended') return res.status(403).json({ message: 'This student account has been suspended. Contact the school administrator.' });
  const set = await getSettings();
  if (!set.resultPortalOpen) return res.status(403).json({ message: 'Result portal is currently closed.' });
  res.json({
    token: sign({ id: s._id, studentId: s.studentId, role: 'student' }),
    student: { _id: s._id, name: s.name, studentId: s.studentId, className: s.className }
  });
});

// ---------- Admin ----------
app.get('/api/admin/stats', auth('admin'), async (req, res) => res.json({
  students: await Student.countDocuments(), teachers: await Teacher.countDocuments(), classes: (await Student.distinct('className')).length
}));

app.get('/api/admin/teachers', auth('admin'), async (req, res) =>
  res.json(await Teacher.find().select('name email phone teacherId initialPassword status assignedClasses classTeacherOf createdAt').sort({ createdAt: -1 })));

app.post('/api/admin/teachers', auth('admin'), async (req, res) => {
  const pw = genPassword();
  const t = await Teacher.create({
    name: req.body.name, email: req.body.email, phone: req.body.phone, teacherId: await nextId(Teacher, 'TCH'),
    password: await bcrypt.hash(pw, 10), initialPassword: pw,
    assignedClasses: (req.body.className && req.body.subject) ? [{ className: req.body.className, subject: req.body.subject }] : []
  });
  res.json({ message: 'Teacher created. Give the teacher the generated ID and password — it stays their password.', teacher: { name: t.name, teacherId: t.teacherId, initialPassword: pw } });
});

app.patch('/api/admin/teachers/:id/status', auth('admin'), async (req, res) => {
  const status = req.body.status === 'suspended' ? 'suspended' : 'active';
  const t = await Teacher.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!t) return res.status(404).json({ message: 'Teacher not found.' });
  res.json({ message: `Teacher ${status === 'suspended' ? 'suspended' : 'activated'}.`, teacher: t });
});

const same = (x, y) => String(x || '').trim().toLowerCase() === String(y || '').trim().toLowerCase();

// A teacher can hold any number of class + subject pairs (several classes,
// several subjects). Assigning never removes what they already have.
app.post('/api/admin/teachers/:id/assign', auth('admin'), async (req, res) => {
  const className = String(req.body.className || '').trim(), subject = String(req.body.subject || '').trim();
  if (!className || !subject) return res.status(400).json({ message: 'Class and subject are required.' });
  const t = await Teacher.findById(req.params.id);
  if (!t) return res.status(404).json({ message: 'Teacher not found.' });
  if (t.assignedClasses.some(a => same(a.className, className) && same(a.subject, subject))) return res.status(400).json({ message: `${t.name} already teaches ${subject} in ${className}.` });
  t.assignedClasses.push({ className, subject });
  await t.save();
  res.json({ message: 'Class assigned.', teacher: t });
});

app.delete('/api/admin/teachers/:id/assign', auth('admin'), async (req, res) => {
  const { className, subject } = req.body;
  const t = await Teacher.findById(req.params.id);
  if (!t) return res.status(404).json({ message: 'Teacher not found.' });
  t.assignedClasses = t.assignedClasses.filter(a => !(a.className === className && a.subject === subject));
  await t.save();
  res.json({ message: 'Assignment removed.', teacher: t });
});

// Remove a subject from a teacher everywhere they teach it.
app.post('/api/admin/teachers/:id/remove-subject', auth('admin'), async (req, res) => {
  const subject = String(req.body.subject || '').trim();
  if (!subject) return res.status(400).json({ message: 'Subject is required.' });
  const t = await Teacher.findById(req.params.id);
  if (!t) return res.status(404).json({ message: 'Teacher not found.' });
  const removed = t.assignedClasses.filter(a => same(a.subject, subject));
  if (!removed.length) return res.status(404).json({ message: `${t.name} is not assigned the subject "${subject}".` });
  t.assignedClasses = t.assignedClasses.filter(a => !same(a.subject, subject));
  await t.save();
  res.json({ message: `${removed[0].subject} removed from ${t.name} (${removed.map(a => a.className).join(', ')}).`, teacher: t });
});

// Remove a class from a teacher: all their subjects in that class, and the
// class-teacher role for it if they had it.
app.post('/api/admin/teachers/:id/remove-class', auth('admin'), async (req, res) => {
  const className = String(req.body.className || '').trim();
  if (!className) return res.status(400).json({ message: 'Class is required.' });
  const t = await Teacher.findById(req.params.id);
  if (!t) return res.status(404).json({ message: 'Teacher not found.' });
  const before = t.assignedClasses.length, wasCt = t.classTeacherOf.some(c => same(c, className));
  t.assignedClasses = t.assignedClasses.filter(a => !same(a.className, className));
  t.classTeacherOf = t.classTeacherOf.filter(c => !same(c, className));
  if (t.assignedClasses.length === before && !wasCt) return res.status(404).json({ message: `${t.name} is not assigned to ${className}.` });
  await t.save();
  res.json({ message: `${className} removed from ${t.name}.`, teacher: t });
});

app.delete('/api/admin/teachers/:id', auth('admin'), async (req, res) => {
  const t = await Teacher.findByIdAndDelete(req.params.id);
  if (!t) return res.status(404).json({ message: 'Teacher not found.' });
  res.json({ message: `${t.name || t.teacherId} deleted.` });
});

app.delete('/api/admin/students/:id', auth('admin'), async (req, res) => {
  const s = await Student.findByIdAndDelete(req.params.id);
  if (!s) return res.status(404).json({ message: 'Student not found.' });
  await Score.deleteMany({ studentId: String(s._id) });
  await Remark.deleteMany({ studentId: s._id });
  res.json({ message: `${s.name || s.studentId} deleted, along with their scores.` });
});

app.get('/api/admin/students', auth('admin'), async (req, res) =>
  res.json(await Student.find().select('name studentId className gender admissionNo initialPassword status createdAt').sort({ createdAt: -1 })));

app.post('/api/admin/students', auth('admin'), async (req, res) => {
  const pw = genPassword();
  const s = await Student.create({
    name: req.body.name, className: req.body.className, gender: req.body.gender || undefined,
    admissionNo: req.body.admissionNo || undefined,
    studentId: await nextId(Student, 'DUR'), password: await bcrypt.hash(pw, 10), initialPassword: pw
  });
  res.json({ message: 'Student created. Give the student the generated ID and first password.', student: { name: s.name, studentId: s.studentId, initialPassword: pw } });
});

app.patch('/api/admin/students/:id/status', auth('admin'), async (req, res) => {
  const status = req.body.status === 'suspended' ? 'suspended' : 'active';
  const s = await Student.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!s) return res.status(404).json({ message: 'Student not found.' });
  res.json({ message: `Student ${status === 'suspended' ? 'suspended' : 'activated'}.`, student: s });
});

// Toggle a teacher as the homeroom/class teacher for a class. A class
// normally has just one class teacher, so assigning one to a class removes
// any other teacher previously marked as class teacher for that class.
app.patch('/api/admin/teachers/:id/class-teacher', auth('admin'), async (req, res) => {
  const { className, make } = req.body;
  if (!className) return res.status(400).json({ message: 'Class is required.' });
  const t = await Teacher.findById(req.params.id);
  if (!t) return res.status(404).json({ message: 'Teacher not found.' });
  if (make) {
    await Teacher.updateMany({ classTeacherOf: className }, { $pull: { classTeacherOf: className } });
    if (!t.classTeacherOf.includes(className)) t.classTeacherOf.push(className);
  } else {
    t.classTeacherOf = t.classTeacherOf.filter(c => c !== className);
  }
  await t.save();
  res.json({ message: make ? `${t.name} is now the class teacher for ${className}.` : 'Class teacher removed.', teacher: t });
});

// ---------- Remarks (affective/psychomotor domain, attendance, comments) ----------
app.get('/api/admin/remarks', auth('admin'), async (req, res) => {
  const { studentId, term, session } = req.query;
  if (!studentId || !term) return res.status(400).json({ message: 'studentId and term are required.' });
  const remark = await Remark.findOne({ studentId, term, session: session || CURRENT_SESSION });
  res.json(remark || {});
});

app.post('/api/admin/remarks', auth('admin'), async (req, res) => {
  const { studentId, term } = req.body;
  const session = req.body.session || CURRENT_SESSION;
  if (!studentId || !term) return res.status(400).json({ message: 'studentId and term are required.' });
  const q = { studentId, term, session };
  const update = {
    ...q,
    affective: req.body.affective || {}, psychomotor: req.body.psychomotor || {},
    timesSchoolOpened: req.body.timesSchoolOpened, timesPresent: req.body.timesPresent,
    nextTermBegins: req.body.nextTermBegins, classTeacherComment: req.body.classTeacherComment,
    principalComment: req.body.principalComment
  };
  const doc = await Remark.findOneAndUpdate(q, update, { upsert: true, new: true });
  res.json({ message: 'Remarks saved.', remark: doc });
});

app.get('/api/admin/results', auth('admin'), async (req, res) => res.json(await Score.find().sort({ createdAt: -1 }).limit(500)));
app.get('/api/admin/portal', auth('admin'), async (req, res) => { const s = await getSettings(); res.json({ resultPortalOpen: s.resultPortalOpen, teacherPortalOpen: s.teacherPortalOpen }); });
app.patch('/api/admin/portal', auth('admin'), async (req, res) => {
  const s = await getSettings();
  if (req.body.type === 'result') s.resultPortalOpen = !s.resultPortalOpen;
  if (req.body.type === 'teacher') s.teacherPortalOpen = !s.teacherPortalOpen;
  await s.save();
  res.json({ resultPortalOpen: s.resultPortalOpen, teacherPortalOpen: s.teacherPortalOpen });
});

// ---------- Teacher ----------
app.get('/api/teacher/me', auth('teacher'), async (req, res) => {
  const t = await Teacher.findById(req.user.id).select('name teacherId assignedClasses');
  if (!t) return res.status(404).json({ message: 'Teacher not found.' });
  res.json(t);
});

app.get('/api/teacher/students', auth('teacher'), async (req, res) => {
  const t = await Teacher.findById(req.user.id);
  if (!t) return res.status(404).json({ message: 'Teacher not found.' });
  const classNames = [...new Set(t.assignedClasses.map(a => a.className))];
  const filter = req.query.className ? { className: req.query.className } : (classNames.length ? { className: { $in: classNames } } : { _id: null });
  res.json(await Student.find(filter).select('_id name studentId className').sort({ name: 1 }));
});

app.post('/api/teacher/scores', auth('teacher'), async (req, res) => {
  const t = await Teacher.findById(req.user.id);
  const s = await Student.findById(req.body.studentId);
  if (!s) return res.status(404).json({ message: 'Student not found.' });
  const allowed = t.assignedClasses.some(a => a.className === s.className && a.subject === req.body.subject);
  if (!allowed) return res.status(403).json({ message: 'You are not assigned to teach this subject for this class.' });
  const total = Number(req.body.ca1 || 0) + Number(req.body.ca2 || 0) + Number(req.body.exam || 0);
  const q = { studentId: s._id, subject: req.body.subject, className: s.className, term: req.body.term, session: req.body.session };
  const doc = await Score.findOneAndUpdate(q, { ...q, studentName: s.name, ca1: req.body.ca1, ca2: req.body.ca2, exam: req.body.exam, total, teacherId: t.teacherId }, { upsert: true, new: true });
  res.json({ message: 'Score saved.', score: doc });
});

// ---------- Messages ----------
app.post('/api/admin/messages', auth('admin'), async (req, res) => {
  const subject = String(req.body.subject || '').trim(), body = String(req.body.body || '').trim();
  if (!subject || !body) return res.status(400).json({ message: 'Subject and message are required.' });
  let teacherId = null, teacherName = 'All Teachers';
  if (req.body.teacherId) {
    const t = await Teacher.findById(req.body.teacherId);
    if (!t) return res.status(404).json({ message: 'Teacher not found.' });
    teacherId = t._id; teacherName = t.name;
  }
  const msg = await Message.create({ teacherId, teacherName, subject, body });
  res.json({ message: `Sent to ${teacherName}.`, sent: msg });
});

app.get('/api/admin/messages', auth('admin'), async (req, res) =>
  res.json(await Message.find().sort({ createdAt: -1 }).limit(200)));

app.get('/api/teacher/messages', auth('teacher'), async (req, res) =>
  res.json(await Message.find({ $or: [{ teacherId: req.user.id }, { teacherId: null }] }).sort({ createdAt: -1 }).limit(100)));

// ---------- Results / grading ----------
function grade(n) {
  if (n >= 75) return ['A1', 'EXCELLENT']; if (n >= 70) return ['B2', 'VERY GOOD']; if (n >= 65) return ['B3', 'GOOD'];
  if (n >= 60) return ['C4', 'CREDIT']; if (n >= 55) return ['C5', 'CREDIT']; if (n >= 50) return ['C6', 'CREDIT'];
  if (n >= 45) return ['D7', 'PASS']; if (n >= 40) return ['E8', 'PASS']; return ['F9', 'FAIL'];
}
const GOOD_STANDING_GRADES = ['A1', 'B2', 'B3', 'C4', 'C5', 'C6'];

app.get('/api/results/:id', auth('student'), async (req, res) => {
  if (req.user.id !== req.params.id) return res.status(403).json({ message: 'Forbidden.' });
  const s = await Student.findById(req.params.id);
  if (!s) return res.status(404).json({ message: 'Student not found.' });

  const term = TERMS.includes(req.query.term) ? req.query.term : '3rd Term';
  const session = req.query.session || CURRENT_SESSION;
  const isFinalTerm = term === '3rd Term';

  const myScores = await Score.find({ studentId: s._id, term, session });
  if (!myScores.length) return res.status(404).json({ message: `No result has been uploaded for ${term} yet.` });

  // Every classmate's score rows for this term (for ranking/class average)
  const classScoresTerm = await Score.find({ className: s.className, term, session });

  // For the final term, build each student's per-subject 1st/2nd/3rd term
  // totals so we can compute a cumulative (whole-session) total/average.
  let cumulativeByStudentSubject = {};
  if (isFinalTerm) {
    const wholeYear = await Score.find({ className: s.className, session, term: { $in: TERMS } });
    wholeYear.forEach(x => {
      const key = x.studentId.toString();
      cumulativeByStudentSubject[key] = cumulativeByStudentSubject[key] || {};
      cumulativeByStudentSubject[key][x.subject] = cumulativeByStudentSubject[key][x.subject] || {};
      if (x.term === '1st Term') cumulativeByStudentSubject[key][x.subject].t1 = x.total;
      if (x.term === '2nd Term') cumulativeByStudentSubject[key][x.subject].t2 = x.total;
      if (x.term === '3rd Term') cumulativeByStudentSubject[key][x.subject].t3 = x.total;
    });
  }

  const rows = myScores.map(sc => {
    let cumulative = null;
    if (isFinalTerm) {
      const c = cumulativeByStudentSubject[s._id.toString()]?.[sc.subject] || {};
      const cumulativeTotal = (c.t1 || 0) + (c.t2 || 0) + (c.t3 || 0);
      cumulative = { term1Total: c.t1 ?? null, term2Total: c.t2 ?? null, term3Total: c.t3 ?? null, cumulativeTotal, cumulativeAverage: cumulativeTotal / 3 };
    }
    // The metric used for grade/position/class-average: cumulative average
    // for the final term (reflects the whole session), this term's own
    // total otherwise (there's nothing to accumulate yet).
    const metric = isFinalTerm ? cumulative.cumulativeAverage : sc.total;

    const peers = classScoresTerm.filter(x => x.subject === sc.subject).map(x => {
      const c = isFinalTerm ? (cumulativeByStudentSubject[x.studentId.toString()]?.[sc.subject] || {}) : null;
      const value = isFinalTerm ? ((((c.t1 || 0) + (c.t2 || 0) + (c.t3 || 0)) / 3)) : x.total;
      return { id: x.studentId.toString(), value };
    });
    const positions = rankPositions(peers);
    const classAverage = peers.length ? peers.reduce((a, b) => a + b.value, 0) / peers.length : metric;

    const [g, c] = grade(metric);
    return {
      subject: sc.subject, ca1: sc.ca1, ca2: sc.ca2, exam: sc.exam, total: sc.total,
      ...(cumulative || {}),
      subjectPosition: positions[s._id.toString()] || '—',
      classAverage: Math.round(classAverage * 100) / 100,
      grade: g, comment: c, gsStatus: GOOD_STANDING_GRADES.includes(g) ? 'GS' : 'NGS'
    };
  });

  const totalScore = Math.round(rows.reduce((a, b) => a + (isFinalTerm ? b.cumulativeAverage : b.total), 0) * 100) / 100;
  const average = rows.length ? Math.round((totalScore / rows.length) * 100) / 100 : 0;
  const [overallGrade] = grade(average);
  const goodStanding = rows.filter(r => r.gsStatus === 'GS').length;
  const notGoodStanding = rows.length - goodStanding;

  const classTeacher = await Teacher.findOne({ classTeacherOf: s.className, status: 'active' }).select('name');
  const remark = await Remark.findOne({ studentId: s._id, term, session });

  res.json({
    student: { name: s.name, studentId: s.studentId, admissionNo: s.admissionNo || '—', gender: s.gender || '—', className: s.className, classTeacherName: classTeacher ? classTeacher.name : '—' },
    term, session, isFinalTerm,
    attendance: { timesSchoolOpened: remark?.timesSchoolOpened ?? null, timesPresent: remark?.timesPresent ?? null },
    nextTermBegins: remark?.nextTermBegins || '',
    rows, totalScore, average, overallGrade, goodStanding, notGoodStanding,
    affective: remark?.affective || {}, psychomotor: remark?.psychomotor || {},
    classTeacherComment: remark?.classTeacherComment || '', principalComment: remark?.principalComment || ''
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ message: 'Server error: ' + (err.code === 11000 ? 'that record already exists.' : err.message) });
});
process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('DURABON backend running on port ' + PORT));
