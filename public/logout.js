document.getElementById('logout').addEventListener('click', async () => {
  try {
    await fetch('/logout', { method: 'POST', credentials: 'include' });
    sessionStorage.clear();
    window.location.href = '/';
  } catch (error) {
    console.error('Logout error:', error);
  }
});

/* ── Thème clair / sombre ── */
(function () {
  const saved = localStorage.getItem('vmm-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);

  function getIcon(theme) { return theme === 'light' ? '🌙' : '☀️'; }

  // Injecter le bouton dans la navbar
  const navbar = document.querySelector('.modern-navbar');
  if (navbar) {
    const btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.title = 'Toggle theme';
    btn.textContent = getIcon(saved);
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('vmm-theme', next);
      btn.textContent = getIcon(next);
    });
    navbar.appendChild(btn);
  }
})();
