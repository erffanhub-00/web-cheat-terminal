// Generate the D1 seed SQL from data/seed.json (the terminal app's seed).
// Usage:
//   node scripts/seed.mjs > scripts/seed.sql
//   wrangler d1 execute cheat-terminal --local  --file scripts/seed.sql
//   wrangler d1 execute cheat-terminal --remote --file scripts/seed.sql
// The output starts by clearing both tables, so re-running it re-seeds
// cleanly. It never touches anything outside categories/entries.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const seed = JSON.parse(readFileSync(path.join(root, 'data', 'seed.json'), 'utf8'));

function sqlText(value) {
  return "'" + String(value ?? '').replace(/'/g, "''") + "'";
}

const out = [];
out.push('-- cheat-terminal web seed — generated from data/seed.json, do not edit by hand.');
out.push('DELETE FROM entries;');
out.push('DELETE FROM categories;');
for (const category of seed.categories) {
  out.push(`INSERT INTO categories (name, title) VALUES (${sqlText(category.name)}, ${sqlText(category.title)});`);
}
const BATCH = 100;
for (let i = 0; i < seed.entries.length; i += BATCH) {
  const chunk = seed.entries.slice(i, i + BATCH);
  const rows = chunk
    .map(
      (e) =>
        `(${sqlText(e.category)}, ${sqlText(e.command)}, ${sqlText(e.title)}, ${sqlText(e.description)}, ${sqlText(e.tags)}, ${sqlText(e.example)}, ${Number(e.level) || 2})`,
    )
    .join(',\n  ');
  out.push(`INSERT INTO entries (category, command, title, description, tags, example, level) VALUES\n  ${rows};`);
}
out.push(`-- ${seed.entries.length} entries, ${seed.categories.length} categories.`);
process.stdout.write(out.join('\n') + '\n');
