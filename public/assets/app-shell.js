/* Renders the app shell (top bar + left sidebar nav) into
 * #app-shell-root. Every app.learn.labendowicz.com page calls
 * renderAppShell('<nav-key>') once, right before its own content script
 * runs — see APP_NAV_ITEMS for the available keys. */
const APP_NAV_ITEMS = [
  { key: 'home', href: '/', icon: '🏠', label: 'Strona główna' },
  { key: 'courses', href: '/courses', icon: '📚', label: 'Kursy' },
  { key: 'profile', href: '/profile', icon: '👤', label: 'Profil' },
];

function renderAppShell(active) {
  const root = document.getElementById('app-shell-root');
  if (!root) return;

  root.innerHTML = `
    <div class="app-topbar">
      <div class="app-topbar-left">
        <button class="app-menu-btn" id="app-menu-btn" aria-label="Otwórz menu">☰</button>
        <a class="logo" href="/">
          <span class="logo-dot"></span>
          learn
        </a>
      </div>
      <div class="app-topbar-right">
        <a class="btn-secondary" href="/profile">👤 Profil</a>
      </div>
    </div>
    <nav class="app-sidebar" id="app-sidebar">
      <div class="app-nav">
        ${APP_NAV_ITEMS.map(it => `
          <a class="app-nav-link${it.key === active ? ' active' : ''}" href="${it.href}">
            <span class="app-nav-icon">${it.icon}</span> ${it.label}
          </a>`).join('')}
      </div>
    </nav>
    <div class="app-shell-overlay" id="app-shell-overlay"></div>
  `;

  const sidebar = document.getElementById('app-sidebar');
  const overlay = document.getElementById('app-shell-overlay');
  const closeSidebar = () => { sidebar.classList.remove('open'); overlay.classList.remove('open'); };
  document.getElementById('app-menu-btn').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  });
  overlay.addEventListener('click', closeSidebar);
}
