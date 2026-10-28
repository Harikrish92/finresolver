/* ============================================================
   theme.js — Light / dark theme toggle
   FinResolver · finresolver.in
   ============================================================ */

const THEME_KEY = 'fr_theme';

/* Chart palette per theme */
const CHART_COLORS = {
  dark: {
    grid:    'rgba(255,255,255,.04)',
    tick:    '#6b7a99',
    accent:  '#00e5a0',
    areaFill:'rgba(0,229,160,.07)',
  },
  light: {
    grid:    'rgba(0,0,0,.06)',
    tick:    '#7a869e',
    accent:  '#00c48a',
    areaFill:'rgba(0,196,138,.08)',
  },
};

function getCurrentTheme() {
  return localStorage.getItem(THEME_KEY) || 'light';
}

function applyTheme(theme, skipCharts = false) {
  const isDark = theme === 'dark';
  document.documentElement.classList.toggle('theme-light', !isDark);

  syncThemeControls(theme);

  // Re-render charts if they exist so colors update immediately
  if (!skipCharts && typeof render === 'function') {
    const appMain = document.getElementById('appMain');
    if (appMain && appMain.style.display !== 'none') render();
  }

  localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
  const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

/* Called from render.js to get chart scale/line colours */
function getChartTheme() {
  return CHART_COLORS[getCurrentTheme()];
}

/* Apply saved theme immediately on script load (before paint) */
applyTheme(getCurrentTheme(), true);

/* Header toggle icon + account-menu "Dark mode" switch */
function syncThemeControls(theme) {
  const isDark = theme === 'dark';
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  }
  const row = document.getElementById('menuThemeRow');
  if (row) {
    row.classList.toggle('is-on', isDark);
    row.setAttribute('aria-checked', isDark ? 'true' : 'false');
  }
}

/* After DOM is ready, update the toggle controls */
document.addEventListener('DOMContentLoaded', () => syncThemeControls(getCurrentTheme()));
