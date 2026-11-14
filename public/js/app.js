import { icon, $, $$ } from './ui.js';
import { refreshLlmStatus } from './store.js';
import * as dashboard from './pages/dashboard.js';
import * as resumes from './pages/resumes.js';
import * as editor from './pages/editor.js';
import * as jd from './pages/jd.js';
import * as apps from './pages/apps.js';
import * as settings from './pages/settings.js';
import * as stories from './pages/stories.js';
import * as mockInterview from './pages/mock-interview.js';
import * as compare from './pages/compare.js';

const NAV = [
  { path: 'dashboard', label: '工作台', icon: 'home', page: dashboard },
  { path: 'resumes', label: '简历库', icon: 'file', page: resumes },
  { path: 'stories', label: '素材库', icon: 'book', page: stories },
  { path: 'jd', label: 'JD 适配', icon: 'target', page: jd },
  { path: 'apps', label: '投递管理', icon: 'calendar', page: apps },
  { path: 'mock', label: '模拟面试', icon: 'speech', page: mockInterview },
  { sep: true },
  { path: 'settings', label: '设置', icon: 'settings', page: settings },
];
const ROUTES = { editor, compare, ...Object.fromEntries(NAV.filter((n) => n.path).map((n) => [n.path, n.page])) };

function renderNav() {
  $('#nav').innerHTML = NAV.map((n) => n.sep ? '<div class="nav-sep"></div>' : '<a href="#/' + n.path + '" data-path="' + n.path + '">' + icon(n.icon) + '<span>' + n.label + '</span></a>').join('');
}

function applyTheme(t) {
  localStorage.setItem('rp-theme', t);
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $$('#theme-switch button').forEach((b) => b.classList.toggle('active', b.dataset.theme === t));
}

function initTheme() {
  const map = { light: 'sun', auto: 'monitor', dark: 'moon' };
  $$('#theme-switch button').forEach((b) => { b.innerHTML = icon(map[b.dataset.theme]); b.onclick = () => applyTheme(b.dataset.theme); });
  applyTheme(localStorage.getItem('rp-theme') || 'auto');
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(localStorage.getItem('rp-theme') || 'auto'));
}

let current = null;
let currentPath = '';

async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, ...rest] = hash.split('/');
  const params = rest.map((p) => decodeURIComponent(p));
  const mod = ROUTES[path] || dashboard;
  if (current?.leave) {
    const ok = await current.leave();
    if (ok === false) { history.replaceState(null, '', '#/' + currentPath); return; }
  }
  currentPath = hash;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === path || ((path === 'editor' || path === 'compare') && a.dataset.path === 'resumes')));
  const view = $('#view');
  view.innerHTML = '';
  view.scrollTop = 0;
  current = mod;
  try {
    await mod.render(view, params);
  } catch (err) {
    console.error(err);
    view.innerHTML = '<div class="page"><div class="card card-pad"><h3>页面出错了</h3><pre class="mono small"></pre></div></div>';
    view.querySelector('pre').textContent = err.stack || err.message;
  }
}

window.addEventListener('beforeunload', (e) => { if (current?.isDirty?.()) { e.preventDefault(); e.returnValue = ''; } });

renderNav();
initTheme();
refreshLlmStatus();
window.addEventListener('hashchange', route);
route();
