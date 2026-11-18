# web-cheat-terminal

The web version of cheat-terminal — search your cheat sheets from the browser, nothing to install. The same 1392 commands as the terminal app (Linux, PowerShell, Docker, Git) with live search, categories, a usefulness filter and one-click copy.

- **1392 commands** from day one: Linux 513, PowerShell 398, Git 267, Docker 214
- **Live search** while you type — across titles, commands, descriptions and tags
- **A real browser**: category sidebar with counts, results list, detail pane with the full description
- **Copy** any command with one click
- **Filter by usefulness**: Essential, Common or Advanced — every command is rated
- **Favorites**: star the commands you use most; they are saved only in your own browser
- **No signup, no login** — visitors can only browse and copy; they cannot add or change anything, in any way

## Admin panel

Content is managed only by the site owner, from the `/admin` page with a password:

- Add, edit and delete entries (command, title, description, category, tags, example, usefulness level)
- Add, edit and delete categories (a category with entries cannot be deleted until its entries are moved or deleted)
- Login with a password — the password is not in the code; set it with `wrangler secret` (see below)

## Run it locally

```sh
git clone https://github.com/erffanhub-00/web-cheat-terminal.git
cd web-cheat-terminal
npm install
npm run seed:local   # creates the local database and seeds all 1392 commands
npm run dev          # http://localhost:8787
```

For local testing the admin password is `admin123` — **local testing only**, and the admin panel shows a warning while that password is active. Set the real password with `wrangler secret`.

## Deploy to Cloudflare (free)

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

## Tests

```sh
npm test
```

22 unit tests for the API handlers (search, filters, levels, CRUD, admin accept/reject) — all must be green. For a real smoke test, start the local server with `npm run dev` and check the pages and the API with curl (home page, `/api/categories`, `/api/entries` with 1392 rows, admin login with a wrong password must return 401).

## Stack

Cloudflare Workers (plain JavaScript, no build step) + D1 (the same SQLite) + a static frontend on the Worker itself. No runtime dependencies; only wrangler is needed for development and deploy.

## Me

[![Telegram](https://img.shields.io/badge/Telegram-erffan__hub-blue?style=for-the-badge&logo=telegram)](https://t.me/erffan_hub)
[![Twitter](https://img.shields.io/badge/Twitter-@Erffanhub__00-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/Erffanhub_00)
[![Gist](https://img.shields.io/badge/Gist-Profile-000000?style=for-the-badge&logo=github)](https://gist.github.com/erffanhub-00)
[![Github](https://img.shields.io/badge/Github-Profile-000000?style=for-the-badge&logo=github)](https://github.com/erffanhub-00)
