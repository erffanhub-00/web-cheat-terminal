// Data layer for the cheat-terminal web app.
//
// Every function takes `db` — a Cloudflare D1 binding in production, or any
// object with the same prepare/bind/all/run/first shape in tests. Nothing
// here knows about HTTP; see index.js for the routes.
//
// Levels (same as the terminal app): 1 = Essential, 2 = Common, 3 = Advanced.

export const LEVEL_NAMES = { 1: 'Essential', 2: 'Common', 3: 'Advanced' };
export const LEVEL_VALUES = { essential: 1, common: 2, advanced: 3 };

export function levelName(level) {
  return LEVEL_NAMES[level] || 'Common';
}

export function normalizeLevel(level) {
  const n = Number(level);
  return n >= 1 && n <= 3 ? n : 2;
}

export function parseLevelParam(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (n >= 1 && n <= 3) return n;
  const byName = LEVEL_VALUES[String(value).toLowerCase()];
  return byName || 0;
}

const CATEGORY_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

function cleanText(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

export function validateEntry(data) {
  const errors = [];
  const command = cleanText(data.command, 500);
  const title = cleanText(data.title, 500);
  const category = cleanText(data.category, 100);
  const description = cleanText(data.description, 4000);
  const tags = cleanText(data.tags, 1000);
  const example = cleanText(data.example, 2000);
  const level = normalizeLevel(data.level);
  if (!command) errors.push('command is required');
  if (!title) errors.push('title is required');
  if (!category) errors.push('category is required');
  else if (!CATEGORY_NAME_RE.test(category)) errors.push('category must be lowercase letters, digits and dashes');
  if (errors.length > 0) return { errors };
  return { errors, entry: { command, title, category, description, tags, example, level } };
}

export function validateCategory(data) {
  const errors = [];
  const name = cleanText(data.name, 100);
  const title = cleanText(data.title, 200);
  if (!name) errors.push('name is required');
  else if (!CATEGORY_NAME_RE.test(name)) errors.push('name must be lowercase letters, digits and dashes');
  if (!title) errors.push('title is required');
  if (errors.length > 0) return { errors };
  return { errors, category: { name, title } };
}

function toEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    command: row.command,
    title: row.title,
    description: row.description || '',
    tags: row.tags || '',
    example: row.example || '',
    level: row.level,
    levelName: levelName(row.level),
  };
}

export async function listCategories(db) {
  const { results } = await db
    .prepare(
      `SELECT c.name, c.title, COUNT(e.id) AS count
       FROM categories c
       LEFT JOIN entries e ON e.category = c.name
       GROUP BY c.name, c.title
       ORDER BY c.title ASC`,
    )
    .all();
  return (results || []).map((r) => ({ name: r.name, title: r.title, count: r.count || 0 }));
}

export async function getCategory(db, name) {
  const row = await db.prepare('SELECT name, title FROM categories WHERE name = ?').bind(name).first();
  return row || null;
}

export async function createCategory(db, data) {
  const { errors, category } = validateCategory(data);
  if (errors.length > 0) return { errors };
  const existing = await getCategory(db, category.name);
  if (existing) return { errors: ['category already exists'] };
  await db.prepare('INSERT INTO categories (name, title) VALUES (?, ?)').bind(category.name, category.title).run();
  return { errors, category };
}

export async function updateCategory(db, name, data) {
  const { errors, category } = validateCategory({ ...data, name });
  if (errors.length > 0) return { errors };
  const existing = await getCategory(db, name);
  if (!existing) return { errors: ['category not found'] };
  await db.prepare('UPDATE categories SET title = ? WHERE name = ?').bind(category.title, name).run();
  return { errors, category: { name, title: category.title } };
}

export async function deleteCategory(db, name) {
  const existing = await getCategory(db, name);
  if (!existing) return { errors: ['category not found'] };
  const { results } = await db.prepare('SELECT COUNT(*) AS n FROM entries WHERE category = ?').bind(name).all();
  const used = (results && results[0] && results[0].n) || 0;
  if (used > 0) return { errors: [`category still has ${used} entries — move or delete them first`] };
  await db.prepare('DELETE FROM categories WHERE name = ?').bind(name).run();
  return { errors: [] };
}

export async function searchEntries(db, params) {
  const q = cleanText(params.q, 500);
  const category = cleanText(params.category, 100);
  const level = parseLevelParam(params.level);
  const ids = (params.ids || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 200);
  const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 500);
  const offset = Math.max(Number(params.offset) || 0, 0);

  const where = [];
  const args = [];
  if (q) {
    const pattern = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    where.push('(command LIKE ? ESCAPE \'\\\' OR title LIKE ? ESCAPE \'\\\' OR description LIKE ? ESCAPE \'\\\' OR tags LIKE ? ESCAPE \'\\\')');
    args.push(pattern, pattern, pattern, pattern);
  }
  if (category) {
    where.push('category = ?');
    args.push(category);
  }
  if (level) {
    where.push('level = ?');
    args.push(level);
  }
  if (ids.length > 0) {
    where.push(`id IN (${ids.map(() => '?').join(',')})`);
    args.push(...ids);
  }
  const clause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

  const countRow = await db.prepare(`SELECT COUNT(*) AS n FROM entries ${clause}`).bind(...args).first();
  const total = (countRow && countRow.n) || 0;

  // Ranking: when searching, the most exact match wins — an exact command
  // first, then a command that starts with the query, then a command that
  // contains it, then a title match, then description/tags. A
  // description-only match must never outrank an exact command match.
  // Without a query the list stays in plain category/title order. The
  // trailing id keeps the order deterministic when everything else ties.
  let orderBy = 'ORDER BY category ASC, title ASC, id ASC';
  let orderArgs = [];
  if (q) {
    const esc = q.replace(/[\\%_]/g, (c) => '\\' + c);
    orderBy = `ORDER BY
      CASE
        WHEN command = ? COLLATE NOCASE THEN 0
        WHEN command LIKE ? ESCAPE '\\' THEN 1
        WHEN command LIKE ? ESCAPE '\\' THEN 2
        WHEN title LIKE ? ESCAPE '\\' THEN 3
        ELSE 4
      END ASC, category ASC, title ASC, id ASC`;
    orderArgs = [q, esc + '%', '%' + esc + '%', '%' + esc + '%'];
  }
  const { results } = await db
    .prepare(`SELECT id, category, command, title, description, tags, example, level FROM entries ${clause} ${orderBy} LIMIT ? OFFSET ?`)
    .bind(...args, ...orderArgs, limit, offset)
    .all();
  return { entries: (results || []).map(toEntry), total };
}

export async function getEntry(db, id) {
  const row = await db
    .prepare('SELECT id, category, command, title, description, tags, example, level FROM entries WHERE id = ?')
    .bind(id)
    .first();
  return toEntry(row);
}

export async function createEntry(db, data) {
  const { errors, entry } = validateEntry(data);
  if (errors.length > 0) return { errors };
  const category = await getCategory(db, entry.category);
  if (!category) return { errors: [`category '${entry.category}' does not exist`] };
  const result = await db
    .prepare('INSERT INTO entries (category, command, title, description, tags, example, level) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(entry.category, entry.command, entry.title, entry.description, entry.tags, entry.example, entry.level)
    .run();
  const id = result && result.meta ? result.meta.last_row_id : null;
  const created = id ? await getEntry(db, id) : { ...entry, id: null };
  return { errors, entry: created };
}

export async function updateEntry(db, id, data) {
  const { errors, entry } = validateEntry(data);
  if (errors.length > 0) return { errors };
  const existing = await getEntry(db, id);
  if (!existing) return { errors: ['entry not found'] };
  const category = await getCategory(db, entry.category);
  if (!category) return { errors: [`category '${entry.category}' does not exist`] };
  await db
    .prepare('UPDATE entries SET category = ?, command = ?, title = ?, description = ?, tags = ?, example = ?, level = ? WHERE id = ?')
    .bind(entry.category, entry.command, entry.title, entry.description, entry.tags, entry.example, entry.level, id)
    .run();
  const updated = await getEntry(db, id);
  return { errors, entry: updated };
}

export async function deleteEntry(db, id) {
  const existing = await getEntry(db, id);
  if (!existing) return { errors: ['entry not found'] };
  await db.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
  return { errors: [] };
}

// --- Import / export (admin) ---
//
// The file format is the seed format: { version, categories, entries },
// and a bare flat array of entries is accepted too (what the terminal
// app's export produces). The rules mirror the terminal app's import:
// a command that already exists in the same category is updated only
// where the incoming data is fuller — a non-empty description longer
// than the stored one, non-empty tags that differ, a level of 1-3 that
// differs, and a non-empty example longer than the stored one (or
// filling an empty one). Everything else counts as unchanged. New
// commands are inserted; missing fields are tolerated (empty
// description/tags, level 0 means "not specified": new entries default
// to Common, updates leave the level alone); a missing category is
// created on the fly.

export async function exportEntries(db) {
  const { results } = await db
    .prepare(
      'SELECT category, command, title, description, tags, example, level FROM entries ORDER BY category ASC, title ASC, id ASC',
    )
    .all();
  return (results || []).map((r) => ({
    category: r.category,
    command: r.command,
    title: r.title,
    description: r.description || '',
    tags: r.tags || '',
    example: r.example || '',
    level: r.level,
  }));
}

export async function getEntryByCommandAndCategory(db, command, category) {
  const row = await db
    .prepare(
      'SELECT id, category, command, title, description, tags, example, level FROM entries WHERE command = ? AND category = ?',
    )
    .bind(command, category)
    .first();
  return toEntry(row);
}

function runeLength(text) {
  return [...String(text ?? '')].length;
}

function displayTitle(name) {
  if (!name) return '';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Normalize an uploaded file into { categories, entries }.
// Returns { errors } when the top-level shape is wrong.
export function parseImportData(data) {
  let categories = [];
  let entries = null;
  if (Array.isArray(data)) {
    entries = data;
  } else if (data && typeof data === 'object') {
    if (!Array.isArray(data.entries)) {
      return { errors: ['file must be a JSON array of entries, or an object with an "entries" array'] };
    }
    entries = data.entries;
    if (data.categories !== undefined) {
      if (!Array.isArray(data.categories)) return { errors: ['"categories" must be an array'] };
      categories = data.categories;
    }
  } else {
    return { errors: ['file must be a JSON array of entries, or an object with an "entries" array'] };
  }
  if (entries.length > 5000) return { errors: ['file has too many entries (max 5000)'] };
  return { categories, entries };
}

function cleanImportEntry(raw) {
  if (!raw || typeof raw !== 'object') return { errors: ['entry is not an object'] };
  const command = cleanText(raw.command, 500);
  const title = cleanText(raw.title, 500);
  const category = cleanText(raw.category, 100);
  const description = cleanText(raw.description, 4000);
  const tags = cleanText(raw.tags, 1000);
  const example = cleanText(raw.example, 2000);
  const level = raw.level === undefined || raw.level === null || raw.level === '' ? 0 : Number(raw.level);
  return { command, title, category, description, tags, example, level: Number.isInteger(level) ? level : 0 };
}

// Compare the file against the live database without writing anything.
// Returns { errors, stats, actions, categoriesToCreate } where actions
// describe exactly what an import would do, one per unique command.
export async function analyzeImport(db, parsed) {
  const errors = [];
  const seen = new Map(); // "category\0command" -> entry (last row in the file wins)
  let duplicatesInFile = 0;
  let skipped = 0;
  parsed.entries.forEach((raw, i) => {
    const entry = cleanImportEntry(raw);
    if (entry.errors) {
      errors.push(`row ${i + 1}: ${entry.errors.join('; ')}`);
      return;
    }
    if (!entry.command) {
      skipped += 1; // empty command: ignored, like the terminal import
      return;
    }
    if (!entry.category) entry.category = 'general';
    if (!CATEGORY_NAME_RE.test(entry.category)) {
      errors.push(`row ${i + 1}: category '${entry.category}' must be lowercase letters, digits and dashes`);
      return;
    }
    const key = entry.category + '\0' + entry.command;
    if (seen.has(key)) duplicatesInFile += 1;
    seen.set(key, entry);
  });

  // Titles declared in the file, for categories created on the fly.
  const fileTitles = new Map();
  (parsed.categories || []).forEach((raw, i) => {
    const { errors: rowErrors, category } = validateCategory(raw ?? {});
    if (rowErrors.length > 0) {
      errors.push(`category ${i + 1}: ${rowErrors.join('; ')}`);
      return;
    }
    fileTitles.set(category.name, category.title);
  });

  // Bulk-load every existing category and entry ONCE, then classify in
  // memory. The old code did one D1 round-trip per entry (plus one per
  // category), so a full 1392-entry file needed ~1400 sequential lookups
  // and the live dry-run preview ran ~78s before failing. Two SELECTs
  // replace all of that; classification below is pure in-memory work.
  const { results: categoryRows } = await db.prepare('SELECT name FROM categories').all();
  const existingCategories = new Set((categoryRows || []).map((r) => r.name));
  const { results: entryRows } = await db
    .prepare('SELECT id, category, command, title, description, tags, example, level FROM entries')
    .all();
  const existingByKey = new Map();
  for (const row of entryRows || []) {
    existingByKey.set(row.category + '\0' + row.command, toEntry(row));
  }

  // Categories the entries need, created if missing.
  const categoriesToCreate = [];
  const needed = [...new Set([...seen.values()].map((e) => e.category))];
  for (const name of needed) {
    if (!existingCategories.has(name)) {
      categoriesToCreate.push({ name, title: fileTitles.get(name) || displayTitle(name) });
    }
  }
  // A file category that no entry uses is still created (it was declared).
  for (const [name, title] of fileTitles) {
    if (!needed.includes(name)) {
      if (!existingCategories.has(name) && !categoriesToCreate.some((c) => c.name === name)) {
        categoriesToCreate.push({ name, title });
      }
    }
  }

  // Classify each entry against the bulk-loaded snapshot.
  const actions = [];
  const samples = { new: [], updated: [], unchanged: [] };
  let isNew = 0;
  let updated = 0;
  let unchanged = 0;
  for (const entry of seen.values()) {
    const existing = existingByKey.get(entry.category + '\0' + entry.command);
    if (!existing) {
      isNew += 1;
      actions.push({ kind: 'new', entry });
      if (samples.new.length < 5) samples.new.push(entry.command);
      continue;
    }
    const fuller = {};
    let changed = false;
    const incomingDesc = entry.description.trim();
    const storedDesc = (existing.description || '').trim();
    if (incomingDesc && (storedDesc === '' || runeLength(incomingDesc) > runeLength(storedDesc))) {
      fuller.description = incomingDesc;
      changed = true;
    }
    const incomingTags = entry.tags.trim();
    if (incomingTags && incomingTags !== (existing.tags || '')) {
      fuller.tags = incomingTags;
      changed = true;
    }
    // Examples follow the same fuller rule as descriptions: an import
    // can fill an empty example or replace a shorter one, but a shorter
    // incoming example never overwrites a fuller stored one. Without
    // this, re-importing an enriched seed would update descriptions
    // but silently drop every example.
    const incomingExample = entry.example.trim();
    const storedExample = (existing.example || '').trim();
    if (incomingExample && (storedExample === '' || runeLength(incomingExample) > runeLength(storedExample))) {
      fuller.example = incomingExample;
      changed = true;
    }
    if (entry.level >= 1 && entry.level <= 3 && entry.level !== existing.level) {
      fuller.level = entry.level;
      changed = true;
    }
    if (!changed) {
      unchanged += 1;
      actions.push({ kind: 'unchanged', entry });
      if (samples.unchanged.length < 5) samples.unchanged.push(entry.command);
    } else {
      updated += 1;
      actions.push({ kind: 'update', entry, id: existing.id, fuller });
      if (samples.updated.length < 5) samples.updated.push(entry.command);
    }
  }
  return {
    errors,
    actions,
    stats: { new: isNew, updated, unchanged, skipped, duplicatesInFile },
    samples,
    categoriesToCreate,
  };
}

export async function applyImport(db, analysis) {
  // Collect every write as a prepared statement and run them through
  // db.batch() in chunks of at most 500 — one round-trip per chunk
  // instead of one per entry. D1 executes a batch in order.
  const statements = [];
  for (const c of analysis.categoriesToCreate) {
    statements.push(db.prepare('INSERT INTO categories (name, title) VALUES (?, ?)').bind(c.name, c.title));
  }
  let created = 0;
  let updated = 0;
  for (const action of analysis.actions) {
    if (action.kind === 'new') {
      const e = action.entry;
      const level = e.level >= 1 && e.level <= 3 ? e.level : 2;
      statements.push(
        db
          .prepare(
            'INSERT INTO entries (category, command, title, description, tags, example, level) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(e.category, e.command, e.title || e.command, e.description, e.tags, e.example, level),
      );
      created += 1;
    } else if (action.kind === 'update') {
      const sets = [];
      const args = [];
      if (action.fuller.description !== undefined) {
        sets.push('description = ?');
        args.push(action.fuller.description);
      }
      if (action.fuller.tags !== undefined) {
        sets.push('tags = ?');
        args.push(action.fuller.tags);
      }
      if (action.fuller.example !== undefined) {
        sets.push('example = ?');
        args.push(action.fuller.example);
      }
      if (action.fuller.level !== undefined) {
        sets.push('level = ?');
        args.push(action.fuller.level);
      }
      statements.push(db.prepare(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`).bind(...args, action.id));
      updated += 1;
    }
  }
  for (let i = 0; i < statements.length; i += 500) {
    await db.batch(statements.slice(i, i + 500));
  }
  return {
    new: created,
    updated,
    unchanged: analysis.stats.unchanged,
    skipped: analysis.stats.skipped,
    categoriesCreated: analysis.categoriesToCreate.map((c) => c.name),
  };
}
