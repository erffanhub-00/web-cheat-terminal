// Test-only adapter: wraps node:sqlite (in-memory) in the same shape as a
// Cloudflare D1 binding — prepare().bind().all()/run()/first() — so the
// real data layer runs against real SQL in tests.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function createTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  return {
    _sqlite: sqlite,
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      const makeBound = (...params) => ({
        async all() {
          return { results: stmt.all(...params), success: true, meta: {} };
        },
        async run() {
          const result = stmt.run(...params);
          return {
            success: true,
            meta: { last_row_id: result.lastInsertRowid, changes: result.changes },
          };
        },
        async first() {
          const row = stmt.get(...params);
          return row === undefined ? null : row;
        },
      });
      // D1 statements can be used with or without .bind().
      return { bind: (...params) => makeBound(...params), ...makeBound() };
    },
    exec(sql) {
      sqlite.exec(sql);
    },
  };
}

export function loadSchema(db) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  db.exec(readFileSync(path.join(root, 'migrations', '0001_init.sql'), 'utf8'));
}

export async function seedTestData(db) {
  db.exec(`
    INSERT INTO categories (name, title) VALUES ('linux', 'Linux'), ('docker', 'Docker');
    INSERT INTO entries (category, command, title, description, tags, example, level) VALUES
      ('linux', 'ls -la', 'ls -la', 'List files with details', 'linux,files', '', 1),
      ('linux', 'grep -r foo .', 'grep -r foo .', 'Search text in files', 'linux,search', '', 2),
      ('docker', 'docker ps', 'docker ps', 'List running containers', 'docker,containers', '', 1),
      ('docker', 'docker compose up', 'docker compose up', 'Start the stack', 'docker,containers', '', 3);
  `);
}
