# DURABON Academy — School Result Management App

Full-stack school website with a public site plus admin, teacher and student
portals for managing accounts and results.

## What's included

### Public website
- Cinematic hero video, layered video/text composition, moving image columns
- A "Welcome to DURABON Academy" video + text section on the Home, About and
  Contact pages — each page has its own wording
- Local branded illustrations (in `frontend/asset/images/`) instead of
  hot-linked stock photos, so the site works with no external image requests
- Scroll animations (AOS) and a subtle mouse-tilt "3D" hover effect on every
  card and image outside the hero, plus rounded corners and layered shadows
  throughout
- Responsive phone and desktop layouts

### Admin
- Admin sign-in (single admin account, credentials in `backend/.env`)
- Dashboard with student/teacher/class counts
- Create teacher accounts (name, email, phone) — the system generates a
  Teacher ID and a permanent password (shown in the teachers table)
- **Teacher assignments page** (`admin/assignments.html`): type a name or ID into
  a search box (no exact ID needed) to open a teacher's management panel —
  add/remove class+subject pairs as chips, set the class teacher, or use the
  quick "remove a whole class" / "remove a subject everywhere" chips
- A teacher can be assigned to any number of classes and subjects
- **Messages** (`admin/messages.html`): send a note to one teacher or
  broadcast to every teacher at once; teachers read them on
  `teacher/messages.html`, linked from their dashboard
- **Delete** teacher and student accounts (deleting a student also deletes their scores)
- **Suspend / activate** any teacher or student account
- Create student accounts — the system generates a Student ID and a
  permanent password
- Review all submitted scores
- Open/close the result portal and the teacher portal independently

### Teacher
- Teacher sign-in with the ID/password issued by admin
- Teachers keep the ID and password the admin generated; there is no password-change step
- Dashboard shows the classes/subjects assigned by admin
- Score entry restricted to the teacher's own assigned class/subject pairs
  (CA1 + CA2 + Exam → term total), stored per student/class/subject/term/session

### Student
- Student sign-in with the ID/password issued by admin
- Keeps the ID and password the admin generated; there is no password-change step
- Result page with 3rd-term report table, totals, average, promotion status
- Print / Save as PDF through the browser

## Report cards, positions and the check-result flow
- Students check results in three separate steps: **choose term → choose class → enter Student ID + password** (`student/select.html`, then `student/login.html`). The class must match the student's record. IDs are not case-sensitive and stray spaces are ignored.
- **3rd Term** prints the full-year report: CA1/CA2/Exam/Total, 1st/2nd/3rd
  term totals, cumulative total and average, subject position, class average,
  grade, comment and GS/NGS. **1st and 2nd Term** show only that term's own
  scores.
- Subject positions and class averages are computed across every student in
  the class (ties share a position, e.g. 1st, 1st, 3rd).
- Affective/psychomotor ratings, attendance, next-term date and the class
  teacher's/principal's comments are entered by the admin on
  `admin/remarks.html`; the class teacher's name comes from the class-teacher
  setting on the Teachers page.
- The result page has **Print** and **Download as PDF** buttons.

## Admin flow (Add Teacher / Add Student)
Both pages start with a row of class buttons; the list below shows only the teachers/students of the class you clicked (typing in the search box searches every class) (Kg 1–3, Primary 1–6, JSS 1–3,
SS 1–3). Click a class, then:
- **Teachers:** add a new teacher (name + subject) to that class, assign an
  existing teacher, or set the class teacher. Table shows name, ID, first
  password, classes, status and a suspend/activate action, with a search bar.
- **Students:** enter the name and generate the ID and password. Table has a
  search bar and suspend/activate.

## Score entry by subject teachers
Each teacher is assigned class + subject pairs by the admin. Several subject
teachers can be assigned to the same class; each sees only their own
class/subject, picks term and session, and enters CA1, CA2 and Exam per
student. The server rejects scores for any class/subject the teacher is not
assigned to.

## Security notes (what changed from the original MVP)
- All passwords (admin, teacher, student) are stored as bcrypt hashes —
  never in plain text
- Every admin/teacher/student API route (other than login) requires a
  JWT session token, issued at login and sent as `Authorization: Bearer <token>`
- Auth endpoints are rate-limited (30 attempts / 15 minutes per IP)
- `helmet` is enabled for standard HTTP security headers
- A suspended teacher or student cannot log in, even with the correct password

## Running the backend

The server reads `backend/.env` no matter which folder you start it from, and refuses to start (with a clear message) if `JWT_SECRET`, `ADMIN_USERNAME` or `ADMIN_PASSWORD_HASH` are missing. On a host, set `NODE_ENV=production` so rate limiting sees real visitor IPs.

1. Install Node.js (18+ recommended).
2. Open a terminal in `backend`.
3. Run `npm install`.
4. A working **`.env` with fake/demo data is already included** so the app
   runs immediately:
   - Admin login: **username `admin`, password `Durabon@Admin2026`**
   - `MONGO_URI` points at a placeholder Atlas cluster that doesn't exist —
     replace it with your real connection string before storing real data.
   - `JWT_SECRET` and `ADMIN_PASSWORD_HASH` are also placeholders — regenerate
     your own before going live (commands are in the `.env` file's comments).
5. Run `npm start`. Backend runs on port 5000 by default.

## Running the frontend

The frontend is static HTML/CSS/JS — open `frontend/index.html` directly, or
serve the `frontend` folder with any static file server. It talks to the
backend using `frontend/js/config.js`, which auto-detects `localhost` and
otherwise calls `/api` on the current domain. See the comments in that file
if you're hosting the frontend and backend on two different domains.

## About the local images

`frontend/asset/images/` contains original SVG illustrations built to match
DURABON's gold/charcoal branding, used in place of the stock photos the
previous version linked directly from Unsplash — this removes the external
image requests and fixes a few images (mission/vision/values, the three
"years" cards) that had no image file at all in the earlier version. If
you'd rather use real photography, `download-original-photos.sh` in that
same folder will fetch the exact original Unsplash photos when run from
your own machine (see the comments inside it).

## Still worth adding before heavy real-world use
- Bulk Excel/CSV score upload
- All 3 terms + annual calculations, subject/class positions, class averages
- Affective/psychomotor assessment fields, configurable promotion rules
- Final professional PDF report generation (server-side, not just browser print)
- Audit logs and backups
- Admin UI button to remove an assignment (the API already supports it —
  `DELETE /api/admin/teachers/:id/assign`)
- A Dockerfile / hosting config for one-click deployment isn't included yet
