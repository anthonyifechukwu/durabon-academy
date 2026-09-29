// Mobile nav toggle
const menu = document.getElementById("menu");
const nav = document.getElementById("nav");
if (menu) menu.addEventListener("click", () => nav.classList.toggle("open"));

// Scroll-reveal animation (AOS) — safe to call even on pages that don't load AOS
if (window.AOS) {
  AOS.init({ duration: 700, once: true, offset: 80, easing: "ease-out-cubic" });
}

// Small helpers shared by every portal page (admin/teacher/student).
// Not all pages use every helper — they're here so each page's inline
// script can stay short.
const Durabon = {
  authHeader(tokenKey) {
    const token = localStorage.getItem(tokenKey);
    return token ? { Authorization: "Bearer " + token } : {};
  },
  async api(path, { method = "GET", body, tokenKey } = {}) {
    const res = await fetch(window.API_BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(tokenKey ? this.authHeader(tokenKey) : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Something went wrong.");
    return data;
  },
  logout(tokenKey, dataKey, redirectTo) {
    localStorage.removeItem(tokenKey);
    if (dataKey) localStorage.removeItem(dataKey);
    location.href = redirectTo;
  }
};

// Subtle 3D tilt on hover for any element with class="tilt" (cards,
// gallery frames, etc.) — pairs with the hover lift in enhance.css.
// Skips touch devices since there's no hover/cursor position there.
(function initTilt() {
  if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;
  document.querySelectorAll(".tilt").forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-8px)`;
    });
    el.addEventListener("mouseleave", () => { el.style.transform = ""; });
  });
})();
