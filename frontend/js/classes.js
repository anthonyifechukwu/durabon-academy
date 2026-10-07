// Canonical list of classes used across admin pages (add teacher, add
// student, class teacher) and the student "check result" class selector,
// so every screen agrees on the exact same class names.
window.DURABON_CLASSES = [
  'Kg 1', 'Kg 2', 'Kg 3',
  'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6',
  'JSS 1', 'JSS 2', 'JSS 3',
  'SS 1', 'SS 2', 'SS 3'
];

// Fills a <select> with the class list (optionally with a placeholder).
function fillClassSelect(selectEl, includeBlank) {
  selectEl.innerHTML =
    (includeBlank ? '<option value="">Select class…</option>' : '') +
    window.DURABON_CLASSES.map(c => `<option value="${c}">${c}</option>`).join('');
}

// Renders a row of class buttons into a container; calls onPick(className)
// when one is clicked and highlights the active one.
function renderClassButtons(container, onPick) {
  container.innerHTML = window.DURABON_CLASSES.map(c => `<button type="button" class="class-btn" data-class="${c}">${c}</button>`).join('');
  container.querySelectorAll('.class-btn').forEach(btn => btn.addEventListener('click', () => {
    container.querySelectorAll('.class-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onPick(btn.dataset.class);
  }));
}

// A friendly "type a name, click a match" teacher picker — used anywhere an
// admin previously had to know and type an exact Teacher ID by hand.
// container: an empty element. teachers: array from GET /admin/teachers.
// onPick(teacher|null) fires when a match is chosen or the input is cleared.
function createTeacherPicker(container, teachers, onPick, placeholder) {
  container.innerHTML = `
    <div class="picker">
      <input class="picker-input" type="text" autocomplete="off" placeholder="${placeholder || 'Type a teacher\u2019s name or ID…'}">
      <div class="picker-list" hidden></div>
    </div>`;
  const input = container.querySelector('.picker-input');
  const list = container.querySelector('.picker-list');
  let selected = null;

  function render(q) {
    const query = q.trim().toLowerCase();
    const matches = !query ? [] : teachers.filter(t =>
      (t.name || '').toLowerCase().includes(query) || t.teacherId.toLowerCase().includes(query)
    ).slice(0, 8);
    list.innerHTML = matches.map(t => `<div class="picker-item" data-id="${t._id}">
        <b>${t.name || t.teacherId}</b>
        <small>${t.teacherId}${(t.assignedClasses || []).length ? ' · ' + t.assignedClasses.map(a => a.className).join(', ') : ''}</small>
      </div>`).join('') || (query ? '<div class="picker-item muted">No match</div>' : '');
    list.hidden = !query;
  }

  input.addEventListener('input', () => { selected = null; onPick(null); render(input.value); });
  input.addEventListener('focus', () => render(input.value));
  list.addEventListener('mousedown', e => {
    const row = e.target.closest('.picker-item[data-id]');
    if (!row) return;
    const t = teachers.find(x => x._id === row.dataset.id);
    selected = t;
    input.value = `${t.name || t.teacherId} (${t.teacherId})`;
    list.hidden = true;
    onPick(t);
  });
  document.addEventListener('click', e => { if (!container.contains(e.target)) list.hidden = true; });

  return {
    getSelected: () => selected,
    clear: () => { selected = null; input.value = ''; list.hidden = true; },
    setTeachers: (t) => { teachers = t; }
  };
}
