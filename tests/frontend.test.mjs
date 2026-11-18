// Frontend tests: public/app.js runs in a small DOM stub (node:vm) so the
// browser-only parts — history in localStorage, sidebar rendering, the
// clear button — can be tested without a browser.
// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appSource = readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle: (c, force) => {
      if (force === undefined) {
        if (set.has(c)) set.delete(c);
        else set.add(c);
      } else if (force) set.add(c);
      else set.delete(c);
    },
    contains: (c) => set.has(c),
  };
}

function makeElement(id) {
  return {
    id,
    handlers: {},
    addEventListener(type, fn) {
      (this.handlers[type] ||= []).push(fn);
    },
    classList: makeClassList(),
    textContent: '',
    innerHTML: '',
    value: '',
    dataset: {},
    style: {},
    scrollIntoView() {},
  };
}

async function loadApp() {
  const elements = {};
  const storage = new Map();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    fetch: async (url) => ({
      json: async () =>
        String(url).includes('/api/categories') ? { categories: [] } : { entries: [], total: 0 },
    }),
    document: {
      getElementById: (id) => (elements[id] ||= makeElement(id)),
      querySelectorAll: () => [],
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(appSource, context, { filename: 'app.js' });
  // Let init()'s async fetches settle.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return {
    context,
    elements,
    storage,
    // Values cross the vm boundary as JSON strings: vm-created objects
    // have a different prototype, so plain deepEqual would fail on them.
    run: (code) => vm.runInContext(code, context),
    fire: (id, type, event) => {
      const el = elements[id];
      (el.handlers[type] || []).forEach((fn) => fn(event));
    },
  };
}

test('history: record, dedup, cap, and clear', async () => {
  const app = await loadApp();
  assert.equal(app.run('JSON.stringify(history)'), '[]');
  assert.equal(app.elements['history-section'].classList.contains('hidden'), true);

  app.run(`history = recordHistory(history, { id: 7, command: 'docker ps' }); saveHistory(history); renderHistory();`);
  assert.deepEqual(JSON.parse(app.storage.get('ct-history')), [{ id: 7, command: 'docker ps' }]);
  assert.equal(app.elements['history-section'].classList.contains('hidden'), false);
  assert.match(app.elements['history-list'].innerHTML, /docker ps/);

  // Viewing it again moves it to the top instead of duplicating it.
  app.run(`history = recordHistory(history, { id: 9, command: 'ls -la' }); history = recordHistory(history, { id: 7, command: 'docker ps' }); saveHistory(history); renderHistory();`);
  assert.deepEqual(
    JSON.parse(app.storage.get('ct-history')).map((h) => h.id),
    [7, 9],
  );

  // Capped at 10, most recent first.
  app.run('for (let i = 0; i < 12; i++) history = recordHistory(history, { id: 100 + i, command: "cmd" + i }); saveHistory(history);');
  const stored = JSON.parse(app.storage.get('ct-history'));
  assert.equal(stored.length, 10);
  assert.equal(stored[0].id, 111);
  assert.equal(stored[9].id, 102);

  // The clear button empties it.
  app.fire('clear-history', 'click');
  assert.deepEqual(JSON.parse(app.storage.get('ct-history')), []);
  assert.equal(app.elements['history-section'].classList.contains('hidden'), true);
});

test('history: bad stored data is ignored', async () => {
  const app = await loadApp();
  app.storage.set(
    'ct-history',
    JSON.stringify([{ id: 'x' }, { command: 'no-id' }, { id: 3, command: 'grep -r' }, null, 'junk']),
  );
  assert.equal(app.run('JSON.stringify(loadHistory())'), JSON.stringify([{ id: 3, command: 'grep -r' }]));
});
