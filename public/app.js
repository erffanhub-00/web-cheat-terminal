// cheat-terminal web — public frontend.
// No login, no editing. Favorites live only in this browser (localStorage).

const CATEGORY_COLORS = {
  linux: '#4a9eff',
  docker: '#00d7d7',
  git: '#ff8700',
  powershell: '#e879f9',
  favorites: '#facc15',
};
const LEVEL_NAMES = { 1: 'Essential', 2: 'Common', 3: 'Advanced' };
const LEVEL_DOT = { 1: 'dot-essential', 2: 'dot-common', 3: 'dot-advanced' };
const FAVORITES_KEY = 'ct-favorites';

const searchInput = document.getElementById('search');
const categoriesEl = document.getElementById('categories');
const levelsEl = document.getElementById('levels');
const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const detailEl = document.getElementById('detail');
const countNoteEl = document.getElementById('count-note');
const toastEl = document.getElementById('toast');

let categories = [];
let activeCategory = '';
let activeLevel = 0;
let favorites = loadFavorites();
let selectedId = null;
let searchTimer = null;

function loadFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  showToast('Copied ✓');
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function categoryColor(name) {
  return CATEGORY_COLORS[name] || '#9aa3af';
}

function renderCategories() {
  const total = categories.reduce((sum, c) => sum + c.count, 0);
  const rows = [{ name: '', title: 'All commands', count: total }, ...categories];
  if (favorites.size > 0) {
    rows.splice(1, 0, { name: 'favorites', title: '★ Favorites', count: favorites.size });
  }
  categoriesEl.innerHTML = rows
    .map(
      (c) => `<li><button class="cat-btn${c.name === activeCategory ? ' active' : ''}" data-cat="${escapeHtml(c.name)}" style="--cat-color: ${categoryColor(c.name)}">
        <span class="cat-name"><span class="cat-swatch"></span>${escapeHtml(c.title)}</span>
        <span class="count">${c.count}</span>
      </button></li>`,
    )
    .join('');
  countNoteEl.textContent = `${total} commands · ${categories.length} categories`;
}

async function loadEntries() {
  const params = new URLSearchParams();
  const q = searchInput.value.trim();
  if (q) params.set('q', q);
  if (activeCategory === 'favorites') {
    if (favorites.size === 0) {
      renderList([], 0);
      return;
    }
    params.set('ids', [...favorites].join(','));
  } else if (activeCategory) {
    params.set('category', activeCategory);
  }
  if (activeLevel) params.set('level', String(activeLevel));
  params.set('limit', '200');
  statusEl.textContent = 'Searching…';
  let data;
  try {
    const response = await fetch('/api/entries?' + params.toString());
    data = await response.json();
  } catch {
    statusEl.textContent = 'Could not reach the server. Is the Worker running?';
    listEl.innerHTML = '';
    return;
  }
  if (data.error) {
    statusEl.textContent = data.error;
    listEl.innerHTML = '';
    return;
  }
  renderList(data.entries, data.total);
}

function renderList(entries, total) {
  statusEl.textContent =
    total === 0 ? 'No commands match. Try another search.' : `${total} command${total === 1 ? '' : 's'}`;
  listEl.innerHTML = entries
    .map(
      (e) => `<li class="result-row${e.id === selectedId ? ' selected' : ''}" data-id="${e.id}">
        <span class="dot ${LEVEL_DOT[e.level] || 'dot-common'} level-dot" title="${LEVEL_NAMES[e.level] || 'Common'}"></span>
        <span class="cmd">${escapeHtml(e.command)}</span>
        <button class="fav-star${favorites.has(e.id) ? ' on' : ''}" data-star="${e.id}" title="Star as favorite" aria-label="Star as favorite">${favorites.has(e.id) ? '★' : '☆'}</button>
      </li>`,
    )
    .join('');
}

function renderDetail(entry) {
  if (!entry) {
    detailEl.innerHTML = '<div class="detail-empty">Pick a command to see it in full — description, tags and the copy button live here.</div>';
    return;
  }
  const tags = (entry.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  detailEl.innerHTML = `
    <h2>${escapeHtml(entry.title)}</h2>
    <div class="meta">#${entry.id} · ${escapeHtml(entry.category)} · ${LEVEL_NAMES[entry.level] || 'Common'}</div>
    <pre>${escapeHtml(entry.command)}</pre>
    ${entry.description ? `<p class="desc">${escapeHtml(entry.description)}</p>` : ''}
    ${entry.example ? `<p class="example">Example: <code>${escapeHtml(entry.example)}</code></p>` : ''}
    ${tags.length > 0 ? `<div class="tag-chips">${tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    <button class="copy-btn" id="copy-btn">Copy command</button>
    <button class="fav-toggle${favorites.has(entry.id) ? ' on' : ''}" id="fav-toggle">${favorites.has(entry.id) ? '★ Favorited' : '☆ Add to favorites'}</button>`;
  document.getElementById('copy-btn').addEventListener('click', () => copyText(entry.command));
  document.getElementById('fav-toggle').addEventListener('click', () => {
    toggleFavorite(entry.id);
    renderDetail(entry);
    loadEntries();
  });
}

function toggleFavorite(id) {
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  saveFavorites();
  renderCategories();
}

listEl.addEventListener('click', async (event) => {
  const star = event.target.closest('[data-star]');
  if (star) {
    event.stopPropagation();
    toggleFavorite(Number(star.dataset.star));
    loadEntries();
    return;
  }
  const row = event.target.closest('.result-row');
  if (!row) return;
  selectedId = Number(row.dataset.id);
  document.querySelectorAll('.result-row').forEach((r) => r.classList.toggle('selected', Number(r.dataset.id) === selectedId));
  try {
    const response = await fetch('/api/entries/' + selectedId);
    const data = await response.json();
    if (data.entry) renderDetail(data.entry);
  } catch {
    showToast('Could not load the details.');
  }
});

categoriesEl.addEventListener('click', (event) => {
  const button = event.target.closest('.cat-btn');
  if (!button) return;
  activeCategory = button.dataset.cat;
  selectedId = null;
  renderDetail(null);
  renderCategories();
  loadEntries();
});

levelsEl.addEventListener('click', (event) => {
  const button = event.target.closest('.level-chip');
  if (!button) return;
  activeLevel = Number(button.dataset.level);
  document.querySelectorAll('.level-chip').forEach((b) => b.classList.toggle('active', Number(b.dataset.level) === activeLevel));
  loadEntries();
});

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadEntries, 150);
});

async function init() {
  try {
    const response = await fetch('/api/categories');
    const data = await response.json();
    categories = data.categories || [];
  } catch {
    statusEl.textContent = 'Could not reach the server. Is the Worker running?';
    return;
  }
  renderCategories();
  await loadEntries();
}

init();
