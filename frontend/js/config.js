/*
  Central place that decides where the frontend sends API requests.

  - While developing on your own computer (localhost), it talks to the
    backend on http://localhost:5000/api.
  - Once hosted, it talks to the separate DURABON Render backend.
*/
(function () {
  const isLocal = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);

  window.API_BASE = isLocal
    ? 'http://localhost:5000/api'
    : 'https://durabon-academy.onrender.com/api';
})();