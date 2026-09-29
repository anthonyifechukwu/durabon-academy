/*
  Central place that decides where the frontend sends API requests.

  - While developing on your own computer (localhost), it talks to the
    backend on http://localhost:5000/api.
  - Once hosted, it calls "/api" on the SAME domain the site is served
    from. That works out of the box if you deploy the frontend and the
    backend behind one domain/reverse proxy (e.g. both served by the
    Express app, or an Nginx/Vercel rewrite that forwards /api to the
    backend).
  - If you host the backend on a DIFFERENT domain (e.g. frontend on
    Vercel/Netlify, backend on Render/Railway), just hardcode that URL
    below instead of the two lines under "hosted".
*/
(function () {
  const isLocal = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);

  window.API_BASE = isLocal
    ? 'http://localhost:5000/api'
    : 'https://durabon-academy.onrender.com/api';

  // Example for a separately hosted backend:
  // window.API_BASE = 'https://your-backend.onrender.com/api';
})();
