#!/usr/bin/env bash
# Boot the API server against the production snapshot, capture the Phase-0
# baseline, then tear the server down. Self-contained: leaves no stray process.
set -u
cd "$(dirname "$0")/../.."

DB="${DB:-.baseline-prod/analytics.db}"
PORT="${PORT:-3001}"
OUT="${OUT:-baseline.json}"
LOG=/tmp/metadb_baseline_server.log

if [ ! -f "$DB" ]; then echo "DB not found: $DB" >&2; exit 2; fi

pkill -f "node server/index.js" 2>/dev/null
sleep 1

DB_PATH="$DB" PORT="$PORT" HOST=127.0.0.1 node server/index.js >"$LOG" 2>&1 &
SRV=$!

cleanup() { kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; }
trap cleanup EXIT

# Wait for health (max ~30s)
ok=0
for i in $(seq 1 60); do
  if curl -s -m2 "http://127.0.0.1:$PORT/api/accounts?months=2026-02" -o /dev/null; then ok=1; break; fi
  sleep 0.5
done
if [ "$ok" != 1 ]; then echo "server did not come up; log:" >&2; cat "$LOG" >&2; exit 3; fi

BASE="http://127.0.0.1:$PORT" node scripts/baseline/capture.mjs >"$OUT"
rc=$?
if [ $rc -ne 0 ]; then echo "capture failed (rc=$rc); server log:" >&2; tail -20 "$LOG" >&2; exit $rc; fi

echo "OK: wrote $OUT ($(wc -c <"$OUT") bytes)" >&2
