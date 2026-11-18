#!/usr/bin/env bash
# Real smoke test: local D1 + wrangler dev, then curl the pages and the API.
# Usage: bash scripts/smoke-test.sh
# Exits non-zero on the first failed check.
set -u
cd "$(dirname "$0")/.."

PORT="${SMOKE_PORT:-8787}"
BASE="http://127.0.0.1:${PORT}"
WRANGLER="./node_modules/.bin/wrangler"
PASS=0

check() { # check <description> <command...>
  local desc="$1"; shift
  if "$@" > /tmp/smoke-out.txt 2>&1; then
    PASS=$((PASS + 1)); echo "ok   - $desc"
  else
    echo "FAIL - $desc"
    cat /tmp/smoke-out.txt
    kill "$DEV_PID" 2>/dev/null
    exit 1
  fi
}

echo "== migrations (local D1) =="
"$WRANGLER" d1 migrations apply cheat-terminal --local > /tmp/smoke-out.txt 2>&1 || { cat /tmp/smoke-out.txt; exit 1; }
echo "ok   - migrations applied"

echo "== seed (local D1) =="
npm run seed:local > /tmp/smoke-out.txt 2>&1 || { cat /tmp/smoke-out.txt; exit 1; }
echo "ok   - seeded"

echo "== dev password (local only) =="
if [ ! -f .dev.vars ]; then
  DEV_PASS="dev-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  printf '%s\n' "ADMIN_PASSWORD=$DEV_PASS" > .dev.vars
  echo "ok   - created .dev.vars with a random local dev password (gitignored, never pushed)"
else
  echo "ok   - .dev.vars already present"
fi
DEV_PASS="$(grep '^ADMIN_PASSWORD=' .dev.vars | head -n 1 | cut -d= -f2-)"
if [ -z "$DEV_PASS" ]; then echo "FAIL - .dev.vars has no ADMIN_PASSWORD"; exit 1; fi

echo "== wrangler dev =="
"$WRANGLER" dev --local --port "$PORT" > /tmp/wrangler-dev.log 2>&1 &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null' EXIT
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "$BASE/api/categories" 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null "$BASE/api/categories" || { echo "FAIL - dev server did not come up"; cat /tmp/wrangler-dev.log; exit 1; }
echo "ok   - dev server up on $PORT"

echo "== pages =="
check "home page loads" curl -fsS "$BASE/" -o /dev/null
check "home page has the app" bash -c "curl -fsS $BASE/ | grep -q cheat-terminal"
check "home page has no link to /admin" python3 -c "
import urllib.request
html = urllib.request.urlopen('$BASE/').read().decode()
assert 'href=\"/admin\"' not in html, 'admin link still present on the public site'
"
check "admin page loads" curl -fsS "$BASE/admin" -o /dev/null
check "admin page has the login" bash -c "curl -fsS $BASE/admin | grep -q 'Admin login'"
check "app.js served" curl -fsS "$BASE/app.js" -o /dev/null
check "styles.css served" curl -fsS "$BASE/styles.css" -o /dev/null
check "app.js has valid syntax" node --check public/app.js
check "admin.js has valid syntax" node --check public/admin.js

echo "== public API =="
check "categories: counts add up to the entries total" python3 -c "
import json, urllib.request
cats = json.load(urllib.request.urlopen('$BASE/api/categories'))['categories']
total = json.load(urllib.request.urlopen('$BASE/api/entries?limit=1'))['total']
assert len(cats) > 0, cats
assert total > 0, total
assert sum(c['count'] for c in cats) == total, (cats, total)
"
check "search 'docker ps' puts the exact command first" python3 -c "
import json, urllib.request
d = json.load(urllib.request.urlopen('$BASE/api/entries?q=docker%20ps'))
assert d['total'] >= 2, d
assert d['entries'][0]['command'] == 'docker ps', d
assert any(e['command'] == 'Port unreachable' for e in d['entries']), d
"
check "level=essential returns only Essential entries" python3 -c "
import json, urllib.request
d = json.load(urllib.request.urlopen('$BASE/api/entries?level=essential&limit=5'))
assert d['total'] > 0, d
assert all(e['level'] == 1 for e in d['entries']), d
"
check "entry by id works" python3 -c "
import json, urllib.request
first = json.load(urllib.request.urlopen('$BASE/api/entries?limit=1'))['entries'][0]
d = json.load(urllib.request.urlopen('$BASE/api/entries/' + str(first['id'])))
assert d['entry']['id'] == first['id'], d
"

echo "== admin auth =="
check "login with wrong password -> 401" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST '$BASE/api/admin/login' -H 'Content-Type: application/json' -d '{\"password\":\"nope\"}')\" = 401"
check "admin API without login -> 401" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' '$BASE/api/admin/entries')\" = 401"
printf '{"password":"%s"}' "$DEV_PASS" > /tmp/smoke-login.json
curl -s -c /tmp/smoke-cookies.txt -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' --data @/tmp/smoke-login.json -o /tmp/smoke-out.txt
grep -q "admin_session" /tmp/smoke-cookies.txt || { echo "FAIL - dev login did not set a session cookie"; cat /tmp/smoke-out.txt; exit 1; }
echo "ok   - login with dev password sets a session cookie"
python3 -c "
for line in open('/tmp/smoke-cookies.txt'):
    parts = line.rstrip('\n').split('\t')
    if len(parts) >= 7 and parts[5] == 'admin_session':
        open('/tmp/smoke-cookie.txt', 'w').write('admin_session=' + parts[6])
"
test -s /tmp/smoke-cookie.txt || { echo "FAIL - no admin_session cookie in jar"; exit 1; }
check "me with cookie -> 200" python3 -c "
import json, urllib.request
cookie = open('/tmp/smoke-cookie.txt').read().strip()
req = urllib.request.Request('$BASE/api/admin/me', headers={'Cookie': cookie})
d = json.load(urllib.request.urlopen(req))
assert d['ok'] is True, d
"
check "admin create + delete round-trip" python3 -c "
import json, urllib.request
cookie = open('/tmp/smoke-cookie.txt').read().strip()
def req(method, path, body=None):
    r = urllib.request.Request('$BASE' + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json', 'Cookie': cookie})
    return json.load(urllib.request.urlopen(r))
created = req('POST', '/api/admin/entries', {'command': 'smoke test cmd', 'title': 'smoke', 'category': 'linux', 'level': 1})
assert created['entry']['id'], created
entry_id = created['entry']['id']
found = json.load(urllib.request.urlopen('$BASE/api/entries?q=smoke%20test%20cmd'))
assert found['total'] == 1, found
req('DELETE', f'/api/admin/entries/{entry_id}')
gone = json.load(urllib.request.urlopen('$BASE/api/entries?q=smoke%20test%20cmd'))
assert gone['total'] == 0, gone
"
check "admin edit flow: load entry, change description, save, read back" python3 -c "
import json, urllib.request
cookie = open('/tmp/smoke-cookie.txt').read().strip()
def req(method, path, body=None):
    r = urllib.request.Request('$BASE' + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json', 'Cookie': cookie})
    return json.load(urllib.request.urlopen(r))
# Regression test for the v1.1.0 edit bug: the Edit button loads the entry
# through GET /api/admin/entries/:id, which did not exist (404), so the
# form never opened. This exercises the exact flow the panel uses.
created = req('POST', '/api/admin/entries', {'command': 'smoke edit cmd', 'title': 'smoke edit', 'description': 'before', 'category': 'linux', 'level': 1})
entry_id = created['entry']['id']
loaded = req('GET', f'/api/admin/entries/{entry_id}')
assert loaded['entry']['description'] == 'before', loaded
saved = req('PUT', f'/api/admin/entries/{entry_id}', {'command': 'smoke edit cmd', 'title': 'smoke edit', 'description': 'after', 'category': 'linux', 'level': 1})
assert saved['entry']['description'] == 'after', saved
reloaded = req('GET', f'/api/admin/entries/{entry_id}')
assert reloaded['entry']['description'] == 'after', reloaded
req('DELETE', f'/api/admin/entries/{entry_id}')
gone = json.load(urllib.request.urlopen('$BASE/api/entries?q=smoke%20edit%20cmd'))
assert gone['total'] == 0, gone
"

echo "== admin import / export =="
cat > /tmp/smoke-import.json <<'EOF'
{"entries": [
  {"category": "linux", "command": "smoke import cmd", "title": "smoke import cmd", "description": "Imported by the smoke test", "tags": "smoke", "level": 1},
  {"category": "docker", "command": "docker ps", "title": "docker ps", "description": "see running containers", "tags": "docker,core-concepts", "level": 1}
]}
EOF
check "export downloads the seed-format JSON" python3 -c "
import json, urllib.request
cookie = open('/tmp/smoke-cookie.txt').read().strip()
req = urllib.request.Request('$BASE/api/admin/export', headers={'Cookie': cookie})
d = json.load(urllib.request.urlopen(req))
assert d['version'] == 1 and 'categories' in d and 'entries' in d, d
total = json.load(urllib.request.urlopen('$BASE/api/entries?limit=1'))['total']
assert len(d['entries']) == total, (len(d['entries']), total)
assert len(d['categories']) > 0, d
"
check "import preview: 1 new, 1 unchanged, nothing written" python3 -c "
import json, urllib.request
cookie = open('/tmp/smoke-cookie.txt').read().strip()
body = open('/tmp/smoke-import.json', 'rb').read()
def post(path):
    req = urllib.request.Request('$BASE' + path, data=body, method='POST', headers={'Content-Type': 'application/json', 'Cookie': cookie})
    return json.load(urllib.request.urlopen(req))
before = json.load(urllib.request.urlopen('$BASE/api/entries?limit=1'))['total']
d = post('/api/admin/import?dryRun=1')
assert d['preview'] is True and d['new'] == 1 and d['unchanged'] == 1 and d['updated'] == 0, d
after = json.load(urllib.request.urlopen('$BASE/api/entries?limit=1'))['total']
assert after == before, (before, after)
"
check "import applies: 1 new entry, then deleted again" python3 -c "
import json, urllib.request
cookie = open('/tmp/smoke-cookie.txt').read().strip()
body = open('/tmp/smoke-import.json', 'rb').read()
def req(method, path, data=None):
    r = urllib.request.Request('$BASE' + path, method=method, data=data, headers={'Content-Type': 'application/json', 'Cookie': cookie})
    return json.load(urllib.request.urlopen(r))
d = req('POST', '/api/admin/import', body)
assert d['preview'] is False and d['new'] == 1 and d['unchanged'] == 1, d
found = json.load(urllib.request.urlopen('$BASE/api/entries?q=smoke%20import%20cmd'))
assert found['total'] == 1, found
entry_id = found['entries'][0]['id']
req('DELETE', f'/api/admin/entries/{entry_id}')
gone = json.load(urllib.request.urlopen('$BASE/api/entries?q=smoke%20import%20cmd'))
assert gone['total'] == 0, gone
"

kill "$DEV_PID" 2>/dev/null
trap - EXIT
echo
echo "SMOKE TEST PASSED ($PASS checks)"
