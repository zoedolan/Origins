#!/usr/bin/env bash
set -u

BASE="${1:-https://vybn.ai}"
API="${2:-https://api.vybn.ai}"
FAIL=0

check_get() {
  name="$1"
  url="$2"
  if curl -fsS -m 15 "$url" >/dev/null; then
    printf 'ok   %s %s
' "$name" "$url"
  else
    printf 'fail %s %s
' "$name" "$url" >&2
    FAIL=1
  fi
}

check_post() {
  name="$1"
  url="$2"
  body="$3"
  if curl -fsS -m 20 -H 'content-type: application/json' -d "$body" "$url" >/dev/null; then
    printf 'ok   %s %s
' "$name" "$url"
  else
    printf 'fail %s %s
' "$name" "$url" >&2
    FAIL=1
  fi
}

check_get llms "$BASE/llms.txt"
check_get ai "$BASE/.well-known/ai.txt"
check_get graph "$BASE/.well-known/semantic-web.jsonld"
check_get mcp "$BASE/mcp.json"
check_get sitemap "$BASE/sitemap.xml"
check_get terrain "$API/api/manifold/points"
check_get instant "$API/api/instant"
check_post walk "$API/api/walk" '{"query":"agent onramp smoke","scope":"Origins"}'

exit "$FAIL"
