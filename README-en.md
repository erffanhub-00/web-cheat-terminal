# web-cheat-terminal

The web version of cheat-terminal — search your cheat sheets from the browser, nothing to install. The same commands as the terminal app (Linux, PowerShell, Docker, Git) with live search, categories, a usefulness filter and one-click copy.

**Live site:** https://web-cheat-terminal.terminal88project.workers.dev

- **Live search** while you type — across commands, titles, descriptions and tags. The best match comes first: an exact command beats everything, then commands that start with your search, then the rest.
- **A real browser**: category sidebar with live counts, a results list, and a detail pane that teaches you the command — what it does, an example when there is one, and its tags.
- **Copy** any command with one click.
- **Filter by usefulness**: Essential, Common or Advanced — every command is rated.
- **Favorites**: star the commands you use most; they are saved only in your own browser.
- **History**: the commands you recently viewed or copied, right in the sidebar. Click one to open it again, clear it whenever you like. Saved only in your browser, like favorites.
- **No signup, no login** — visitors can only browse and copy; they cannot add or change anything, in any way.

## Admin panel

Content is managed only by the site owner, from the `/admin` page with a password — type the address in the browser, there is no link to it on the site:

- Add, edit and delete entries (command, title, description, category, tags, example, usefulness level)
- Add, edit and delete categories (a category with entries cannot be deleted until its entries are moved or deleted)
- Find anything fast: the entries list has live search plus category and usefulness filters, and loads in pages so it stays quick.
- Import and export with a file: download everything as one JSON file, edit it, and import it back. The import shows a preview first — how many entries are new, updated or unchanged — and updates an existing command only where the file has more to say.
- Login with a password — the password is not in the code; set it as a Worker secret (see below). Until a password is set, admin login is disabled entirely — no default password works on the live site.

## Run it locally

```sh
git clone https://github.com/erffanhub-00/web-cheat-terminal.git
cd web-cheat-terminal
npm install
npm run seed:local   # creates the local database and seeds it from data/seed.json
npm run dev          # http://localhost:8787
```

For local testing, create a file named `.dev.vars` with a password you choose for local use only:

```sh
ADMIN_PASSWORD=<a password you choose, for local use only>
```

That file stays on your machine — it is gitignored and never committed. On the live site the real password comes from the Worker secret instead.

## Deploy to Cloudflare (free)

The site is already deployed: https://web-cheat-terminal.terminal88project.workers.dev — the D1 database is named `cheat-terminal` (id `f5ed3d74-8468-4496-8e72-c80b12d1bbd7`). To deploy again or from scratch:

```sh
npx wrangler login
npx wrangler d1 create cheat-terminal
```

Put the id it prints in place of `database_id` in `wrangler.toml`, then:

```sh
npx wrangler d1 migrations apply cheat-terminal --remote
npm run seed:remote
npx wrangler secret put ADMIN_PASSWORD
npx wrangler deploy
```

The site comes up at `https://web-cheat-terminal.<your-subdomain>.workers.dev`. Set the admin password with:

```sh
npx wrangler secret put ADMIN_PASSWORD
```

That password is both the admin login and the key that signs sessions — changing it invalidates every existing session.

## API

Everything returns JSON:

- `GET /api/categories` — categories with entry counts
- `GET /api/entries?q=&category=&level=&ids=&limit=&offset=` — search and filter; `level` takes a number (1–3) or a name (essential/common/advanced); `ids` is a comma-separated list of ids for favorites
- `GET /api/entries/:id` — one entry
- `POST /api/admin/login` — `{"password": "..."}`, sets the session cookie
- `GET /api/admin/me`, `POST /api/admin/logout`
- `GET/POST /api/admin/entries`, `PUT/DELETE /api/admin/entries/:id`
- `GET/POST /api/admin/categories`, `PUT/DELETE /api/admin/categories/:name`
- `GET /api/admin/export` — download all entries and categories as one JSON file (seed format)
- `POST /api/admin/import` — upload a JSON file; `?dryRun=1` previews the import without writing anything

## Tests

```sh
npm test
```

Unit tests for the API handlers (search and ranking, filters, levels, CRUD, admin accept/reject) — all must be green. For a real smoke test, run `bash scripts/smoke-test.sh`: it starts the local server and checks the pages and the API with curl (home page, `/api/categories`, search ranking, admin login with a wrong password must return 401).

## Stack

Cloudflare Workers (plain JavaScript, no build step) + D1 (the same SQLite) + a static frontend on the Worker itself. No runtime dependencies; only wrangler is needed for development and deploy.

## Me

[![Telegram](https://img.shields.io/badge/Telegram-erffan__hub-blue?style=for-the-badge&logo=telegram)](https://t.me/erffan_hub)
[![Twitter](https://img.shields.io/badge/Twitter-@Erffanhub__00-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/Erffanhub_00)
[![Gist](https://img.shields.io/badge/Gist-Profile-000000?style=for-the-badge&logo=github)](https://gist.github.com/erffanhub-00)
[![Github](https://img.shields.io/badge/Github-Profile-000000?style=for-the-badge&logo=github)](https://github.com/erffanhub-00)
