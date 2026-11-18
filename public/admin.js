// cheat-terminal web — admin panel.
// Login is a password checked by the Worker (ADMIN_PASSWORD secret).
// All management calls need the session cookie the login sets.

const LEVEL_NAMES = { 1: 'Essential', 2: 'Common', 3: 'Advanced' };
const toastEl = document.getElementById('toast');
const loginView = document.getElementById('login-view');
const manageView = document.getElementById('manage-view');
const logoutBtn = document.getElementById('logout-btn');
const devWarning = document.getElementById('dev-warning');

let categories = [];

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.remove('show'), 2000);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showLogin() {
  loginView.classList.remove('hidden');
  manageView.classList.add('hidden');
  logoutBtn.classList.add('hidden');
  devWarning.classList.add('hidden');
}

function showManage(devPassword) {
  loginView.classList.add('hidden');
  manageView.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  devWarning.classList.toggle('hidden', !devPassword);
}

async function checkSession() {
  try {
    const me = await api('/api/admin/me');
    showManage(me.devPassword);
    await refreshAll();
  } catch {
    showLogin();
  }
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');
  try {
    const result = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password: document.getElementById('password').value }),
    });
    document.getElementById('password').value = '';
    showManage(result.devPassword);
    await refreshAll();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  showLogin();
});

document.querySelectorAll('.tab-btn').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === button));
    document.getElementById('tab-entries').classList.toggle('hidden', button.dataset.tab !== 'entries');
    document.getElementById('tab-categories').classList.toggle('hidden', button.dataset.tab !== 'categories');
  });
});

async function refreshAll() {
  await refreshCategories();
  await refreshEntries();
}

async function refreshCategories() {
  const data = await api('/api/admin/categories');
  categories = data.categories;
  document.getElementById('category-rows').innerHTML = categories
    .map(
      (c) => `<tr>
        <td><code>${escapeHtml(c.name)}</code></td>
        <td>${escapeHtml(c.title)}</td>
        <td>${c.count}</td>
        <td>
          <button class="row-btn" data-edit-cat="${escapeHtml(c.name)}">Edit title</button>
          <button class="row-btn danger" data-del-cat="${escapeHtml(c.name)}">Delete</button>
        </td>
      </tr>`,
    )
    .join('');
  document.getElementById('f-category').innerHTML = categories
    .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.title)}</option>`)
    .join('');
}

async function refreshEntries() {
  const q = document.getElementById('entry-search').value.trim();
  const params = new URLSearchParams({ limit: '500' });
  if (q) params.set('q', q);
  const data = await api('/api/admin/entries?' + params.toString());
  document.getElementById('entry-count').textContent = `${data.total} entries`;
  document.getElementById('entry-rows').innerHTML = data.entries
    .map(
      (e) => `<tr>
        <td><code>${escapeHtml(e.command)}</code></td>
        <td>${escapeHtml(e.category)}</td>
        <td>${LEVEL_NAMES[e.level] || 'Common'}</td>
        <td>
          <button class="row-btn" data-edit-entry="${e.id}">Edit</button>
          <button class="row-btn danger" data-del-entry="${e.id}">Delete</button>
        </td>
      </tr>`,
    )
    .join('');
}

document.getElementById('entry-search').addEventListener('input', () => {
  clearTimeout(refreshEntries.timer);
  refreshEntries.timer = setTimeout(refreshEntries, 200);
});

document.getElementById('new-entry-btn').addEventListener('click', () => {
  openEntryForm(null);
});

function openEntryForm(entry) {
  const form = document.getElementById('entry-form');
  document.getElementById('entry-form-title').textContent = entry ? `Edit entry #${entry.id}` : 'New entry';
  document.getElementById('entry-id').value = entry ? entry.id : '';
  document.getElementById('f-command').value = entry ? entry.command : '';
  document.getElementById('f-title').value = entry ? entry.title : '';
  document.getElementById('f-description').value = entry ? entry.description : '';
  document.getElementById('f-category').value = entry ? entry.category : categories[0]?.name || '';
  document.getElementById('f-tags').value = entry ? entry.tags : '';
  document.getElementById('f-example').value = entry ? entry.example : '';
  document.getElementById('f-level').value = entry ? String(entry.level) : '2';
  document.getElementById('entry-error').classList.add('hidden');
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('entry-cancel').addEventListener('click', () => {
  document.getElementById('entry-form').classList.add('hidden');
});

document.getElementById('entry-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById('entry-error');
  errorEl.classList.add('hidden');
  const id = document.getElementById('entry-id').value;
  const body = {
    command: document.getElementById('f-command').value,
    title: document.getElementById('f-title').value,
    description: document.getElementById('f-description').value,
    category: document.getElementById('f-category').value,
    tags: document.getElementById('f-tags').value,
    example: document.getElementById('f-example').value,
    level: Number(document.getElementById('f-level').value),
  };
  try {
    if (id) await api('/api/admin/entries/' + id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/admin/entries', { method: 'POST', body: JSON.stringify(body) });
    document.getElementById('entry-form').classList.add('hidden');
    showToast('Saved ✓');
    await refreshEntries();
    await refreshCategories();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
});

document.getElementById('category-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById('category-error');
  errorEl.classList.add('hidden');
  try {
    await api('/api/admin/categories', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('c-name').value,
        title: document.getElementById('c-title').value,
      }),
    });
    document.getElementById('c-name').value = '';
    document.getElementById('c-title').value = '';
    showToast('Category added ✓');
    await refreshCategories();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
});

document.addEventListener('click', async (event) => {
  const editEntry = event.target.closest('[data-edit-entry]');
  if (editEntry) {
    const data = await api('/api/admin/entries/' + editEntry.dataset.editEntry);
    openEntryForm(data.entry);
    return;
  }
  const delEntry = event.target.closest('[data-del-entry]');
  if (delEntry) {
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    await api('/api/admin/entries/' + delEntry.dataset.delEntry, { method: 'DELETE' });
    showToast('Entry deleted');
    await refreshEntries();
    await refreshCategories();
    return;
  }
  const editCat = event.target.closest('[data-edit-cat]');
  if (editCat) {
    const name = editCat.dataset.editCat;
    const current = categories.find((c) => c.name === name);
    const title = prompt('New title for category "' + name + '":', current ? current.title : '');
    if (title === null) return;
    await api('/api/admin/categories/' + encodeURIComponent(name), {
      method: 'PUT',
      body: JSON.stringify({ title }),
    });
    showToast('Category updated ✓');
    await refreshCategories();
    return;
  }
  const delCat = event.target.closest('[data-del-cat]');
  if (delCat) {
    const name = delCat.dataset.delCat;
    if (!confirm('Delete category "' + name + '"? It must have no entries left.')) return;
    try {
      await api('/api/admin/categories/' + encodeURIComponent(name), { method: 'DELETE' });
      showToast('Category deleted');
      await refreshCategories();
    } catch (err) {
      alert(err.message);
    }
  }
});

checkSession();
