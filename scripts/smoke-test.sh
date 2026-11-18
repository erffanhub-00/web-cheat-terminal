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
check "admin page loads" curl -fsS "$BASE/admin" -o /dev/null
check "admin page has the login" bash -c "curl -fsS $BASE/admin | grep -q 'Admin login'"
check "app.js served" curl -fsS "$BASE/app.js" -o /dev/null
check "styles.css served" curl -fsS "$BASE/styles.css" -o /dev/null

echo "== public API =="
check "categories: 4, counts add up to 1392" python3 -c "
import json, urllib.request
d = json.load(urllib.request.urlopen('$BASE/api/categories'))
assert len(d['categories']) == 4, d
assert sum(c['count'] for c in d['categories']) == 1392, d
"
check "entries: total is 1392" python3 -c "
import json, urllib.request
d = json.load(urllib.request.urlopen('$BASE/api/entries?limit=1'))
assert d['total'] == 1392, d
"
check "search 'docker ps' finds the exact command among matches" python3 -c "
import json, urllib.request
d = json.load(urllib.request.urlopen('$BASE/api/entries?q=docker%20ps'))
assert d['total'] >= 1, d
assert any(e['command'] == 'docker ps' for e in d['entries']), d
"
check "level=essential finds 367" python3 -c "
import json, urllib.request
d = json.load(urllib.request.urlopen('$BASE/api/entries?level=essential&limit=1'))
assert d['total'] == 367, d
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
curl -s -c /tmp/smoke-cookies.txt -X POST "$BASE/api/admin/login" -H 'Content-Type: application/json' -d '{"password":"admin123"}' -o /tmp/smoke-out.txt
grep -q "admin_session" /tmp/smoke-cookies.txt || { echo "FAIL - dev login did not set a session cookie"; cat /tmp/smoke-out.txt; exit 1; }
echo "ok   - login with dev password sets a session cookie"
check "me with cookie -> 200, devPassword true" python3 -c "
import json, urllib.request
cookie = None
for line in open('/tmp/smoke-cookies.txt'):
    parts = line.rstrip('\n').split('\t')
    if len(parts) >= 7 and parts[5] == 'admin_session':
        cookie = 'admin_session=' + parts[6]
assert cookie, 'no admin_session cookie in jar'
req = urllib.request.Request('$BASE/api/admin/me', headers={'Cookie': cookie})
d = json.load(urllib.request.urlopen(req))
assert d['ok'] is True and d['devPassword'] is True, d
"
check "admin create + delete round-trip" python3 -c "
import json, urllib.request
cookie = None
for line in open('/tmp/smoke-cookies.txt'):
    parts = line.rstrip('\n').split('\t')
    if len(parts) >= 7 and parts[5] == 'admin_session':
        cookie = 'admin_session=' + parts[6]
assert cookie, 'no admin_session cookie in jar'
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

kill "$DEV_PID" 2>/dev/null
trap - EXIT
echo
echo "SMOKE TEST PASSED ($PASS checks)"
