// Wraps the existing header/main content of an admin page in a persistent
// left sidebar, without needing to restructure each page's own HTML.
// Called at the end of the body as: mountAdminSidebar('students.html')
function mountAdminSidebar(active) {
  const items = [
    ['dashboard.html', 'Dashboard'],
    ['students.html', 'Students'],
    ['teachers.html', 'Teachers'],
    ['assignments.html', 'Assignments'],
    ['messages.html', 'Messages'],
    ['results.html', 'Results'],
    ['portal.html', 'Portal Control']
  ];

  const shell = document.createElement('div');
  shell.className = 'admin-shell';

  const nav = document.createElement('nav');
  nav.className = 'admin-sidebar';
  nav.innerHTML =
    `<a class="brand" href="../index.html"><span class="logo">DA</span><span><b>DURABON</b><small>ADMIN</small></span></a>` +
    items.map(([href, label]) => `<a href="${href}"${href === active ? ' class="active"' : ''}>${label}</a>`).join('') +
    `<a href="#" class="logout-link" id="sidebarLogout">Log Out</a>`;

  const main = document.createElement('div');
  main.className = 'admin-main';

  // Move every existing body child except <script> tags into the new main
  // pane — scripts stay put (and keep running) exactly where they were.
  Array.from(document.body.childNodes).forEach(node => {
    if (node.nodeType !== 1 || node.tagName !== 'SCRIPT') main.appendChild(node);
  });

  shell.appendChild(nav);
  shell.appendChild(main);
  document.body.appendChild(shell);

  document.getElementById('sidebarLogout').addEventListener('click', e => {
    e.preventDefault();
    localStorage.removeItem('adminToken');
    location.href = 'login.html';
  });
}
