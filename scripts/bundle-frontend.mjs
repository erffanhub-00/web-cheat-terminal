// Bundle the static frontend (public/) into src/frontend-embedded.js so the
// Worker can serve it even without the ASSETS binding — that is how the
// single-file Cloudflare API deploy works. Wrangler deploys keep using the
// ASSETS binding and ignore this file.
// Usage: node scripts/bundle-frontend.mjs   (also: npm run bundle:frontend)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/admin': ['admin.html', 'text/html; charset=utf-8'],
  '/admin.html': ['admin.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/admin.css': ['admin.css', 'text/css; charset=utf-8'],
};

const entries = Object.entries(files).map(([route, [file, type]]) => {
  const body = readFileSync(path.join(root, 'public', file), 'utf8');
  return `  ${JSON.stringify(route)}: { type: ${JSON.stringify(type)}, body: ${JSON.stringify(body)} },`;
});

const out = `// GENERATED — do not edit by hand. Run \`npm run bundle:frontend\`.
// The static frontend, embedded so the Worker can serve it without the
// ASSETS binding (single-file Cloudflare API deploy). Wrangler deploys use
// the ASSETS binding instead and never touch this file.
export const EMBEDDED_FILES = {
${entries.join('\n')}
};

export function serveEmbedded(pathname) {
  const file = EMBEDDED_FILES[pathname];
  if (!file) return null;
  return new Response(file.body, { status: 200, headers: { 'Content-Type': file.type } });
}
`;
writeFileSync(path.join(root, 'src', 'frontend-embedded.js'), out);
console.log(`bundled ${Object.keys(files).length} frontend files into src/frontend-embedded.js`);
