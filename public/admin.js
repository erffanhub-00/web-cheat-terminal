// cheat-terminal web — admin panel.
// Login is a password checked by the Worker (ADMIN_PASSWORD secret).
// All management calls need the session cookie the login sets.

const LEVEL_NAMES = { 1: 'Essential', 2: 'Common', 3: 'Advanced' };
const ENTRY_PAGE = 100;
const toastEl = document.getElementById('toast');
const loginView = document.getElementById('login-view');
const manageView = document.getElementById('manage-view');
const logoutBtn = document.getElementById('logout-btn');
const devWarning = document.getElementById('dev-warning');

let categories = [];
let entryOffset = 0;
let entryShown = 0;
let entryTotal = 0;
let importText = '';

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

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + name));
}

document.querySelectorAll('.tab-btn').forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

async function refreshAll() {
  await refreshCategories();
  await refreshEntries('reset');
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
  const options = categories
    .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.title)}</option>`)
    .join('');
  document.getElementById('f-category').innerHTML = options;
  const filterEl = document.getElementById('filter-category');
  const prevFilter = filterEl.value;
  filterEl.innerHTML = '<option value="">All categories</option>' + options;
  if ([...filterEl.options].some((o) => o.value === prevFilter)) filterEl.value = prevFilter;
}

function entryRowHtml(e) {
  return `<tr>
    <td><code>${escapeHtml(e.command)}</code></td>
    <td class="desc-cell">${escapeHtml(e.description || '')}</td>
    <td>${escapeHtml(e.category)}</td>
    <td>${LEVEL_NAMES[e.level] || 'Common'}</td>
    <td>
      <button class="row-btn" data-edit-entry="${e.id}">Edit</button>
      <button class="row-btn danger" data-del-entry="${e.id}">Delete</button>
    </td>
  </tr>`;
}

function updateEntryCount() {
  const countEl = document.getElementById('entry-count');
  countEl.textContent =
    entryShown < entryTotal ? `Showing ${entryShown} of ${entryTotal} entries` : `${entryTotal} entries`;
  document.getElementById('show-more-btn').classList.toggle('hidden', entryShown >= entryTotal);
}

// mode: 'reset' (new search/filter), 'more' (next page), 'reload' (same rows again).
async function refreshEntries(mode = 'reset') {
  const q = document.getElementById('entry-search').value.trim();
  const category = document.getElementById('filter-category').value;
  const level = document.getElementById('filter-level').value;
  if (mode === 'reset') {
    entryOffset = 0;
    entryShown = 0;
  }
  const limit = mode === 'reload' ? Math.max(entryShown, ENTRY_PAGE) : ENTRY_PAGE;
  const offset = mode === 'reload' ? 0 : entryOffset;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  if (level !== '0') params.set('level', level);
  const data = await api('/api/admin/entries?' + params.toString());
  entryTotal = data.total;
  const rowsEl = document.getElementById('entry-rows');
  if (mode === 'more') {
    rowsEl.innerHTML += data.entries.map(entryRowHtml).join('');
    entryShown += data.entries.length;
    entryOffset += data.entries.length;
  } else {
    rowsEl.innerHTML = data.entries.map(entryRowHtml).join('');
    entryShown = data.entries.length;
    entryOffset = data.entries.length;
  }
  updateEntryCount();
}

document.getElementById('entry-search').addEventListener('input', () => {
  clearTimeout(refreshEntries.timer);
  refreshEntries.timer = setTimeout(() => refreshEntries('reset'), 200);
});
document.getElementById('filter-category').addEventListener('change', () => refreshEntries('reset'));
document.getElementById('filter-level').addEventListener('change', () => refreshEntries('reset'));
document.getElementById('show-more-btn').addEventListener('click', () => refreshEntries('more'));

document.getElementById('new-entry-btn').addEventListener('click', () => {
  openEntryForm(null);
});

document.getElementById('new-category-btn').addEventListener('click', () => {
  switchTab('categories');
  document.getElementById('c-name').focus();
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
    await refreshEntries('reload');
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

// --- Import / export ---

async function postImport(dryRun) {
  const response = await fetch('/api/admin/import' + (dryRun ? '?dryRun=1' : ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: importText,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `Import failed (${response.status})`);
    err.details = data.errors || [];
    throw err;
  }
  return data;
}

function renderImportErrors(list) {
  document.getElementById('import-errors').innerHTML =
    '<ul>' + list.map((e) => `<li>${escapeHtml(e)}</li>`).join('') + '</ul>';
}

function renderImportPreview(data) {
  const bits = [
    `<span><strong>${data.new}</strong> new</span>`,
    `<span><strong>${data.updated}</strong> updated</span>`,
    `<span><strong>${data.unchanged}</strong> unchanged</span>`,
  ];
  if (data.skipped) bits.push(`<span><strong>${data.skipped}</strong> skipped</span>`);
  if (data.duplicatesInFile) bits.push(`<span><strong>${data.duplicatesInFile}</strong> duplicates in file</span>`);
  if (data.categoriesToCreate.length > 0) {
    bits.push(
      `<span><strong>${data.categoriesToCreate.length}</strong> new categor${data.categoriesToCreate.length === 1 ? 'y' : 'ies'}: ${data.categoriesToCreate.map(escapeHtml).join(', ')}</span>`,
    );
  }
  document.getElementById('import-summary').innerHTML = bits.join('');
  const samples = [];
  if (data.samples.new.length > 0) samples.push('New: ' + data.samples.new.join(', '));
  if (data.samples.updated.length > 0) samples.push('Updated: ' + data.samples.updated.join(', '));
  document.getElementById('import-samples').textContent = samples.join(' · ');
  document.getElementById('import-errors').innerHTML = '';
  const confirmBtn = document.getElementById('import-confirm-btn');
  confirmBtn.disabled = !(data.new + data.updated > 0);
  confirmBtn.textContent = `Import (${data.new} new, ${data.updated} updated)`;
  document.getElementById('import-preview').classList.remove('hidden');
}

function resetImportUI() {
  importText = '';
  document.getElementById('import-file').value = '';
  document.getElementById('import-file-name').textContent = '';
  document.getElementById('import-preview-btn').disabled = true;
  document.getElementById('import-preview').classList.add('hidden');
}

document.getElementById('import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  resetImportUI();
  document.getElementById('import-result').textContent = '';
  if (!file) return;
  importText = await file.text();
  document.getElementById('import-file-name').textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
  document.getElementById('import-preview-btn').disabled = false;
});

document.getElementById('import-preview-btn').addEventListener('click', async () => {
  try {
    const data = await postImport(true);
    renderImportPreview(data);
    document.getElementById('import-result').textContent = '';
  } catch (err) {
    document.getElementById('import-summary').innerHTML = '';
    document.getElementById('import-samples').textContent = '';
    renderImportErrors(err.details.length > 0 ? err.details : [err.message]);
    document.getElementById('import-confirm-btn').disabled = true;
    document.getElementById('import-preview').classList.remove('hidden');
  }
});

document.getElementById('import-confirm-btn').addEventListener('click', async () => {
  try {
    const data = await postImport(false);
    const cats =
      data.categoriesCreated.length > 0 ? `, ${data.categoriesCreated.length} new categor${data.categoriesCreated.length === 1 ? 'y' : 'ies'}` : '';
    document.getElementById('import-result').textContent =
      `Imported: ${data.new} new, ${data.updated} updated, ${data.unchanged} unchanged${cats}.`;
    showToast('Import done ✓');
    resetImportUI();
    await refreshAll();
  } catch (err) {
    renderImportErrors(err.details.length > 0 ? err.details : [err.message]);
    document.getElementById('import-preview').classList.remove('hidden');
  }
});

document.getElementById('import-cancel-btn').addEventListener('click', () => {
  resetImportUI();
  document.getElementById('import-result').textContent = '';
});

document.getElementById('export-btn').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/admin/export');
    if (!response.ok) throw new Error(`Export failed (${response.status})`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cheat-terminal-export.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Export downloaded ✓');
  } catch (err) {
    showToast(err.message);
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
    await refreshEntries('reload');
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
