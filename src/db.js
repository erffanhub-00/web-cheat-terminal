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
  const { results } = await db
    .prepare(`SELECT id, category, command, title, description, tags, example, level FROM entries ${clause} ORDER BY category ASC, title ASC LIMIT ? OFFSET ?`)
    .bind(...args, limit, offset)
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
