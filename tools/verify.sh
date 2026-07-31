#!/usr/bin/env bash
# Run both determinism oracles and print their digests.
#   tools/verify.sh            -> print current digests
#   tools/verify.sh save NAME  -> record a baseline
#   tools/verify.sh check NAME -> diff against a baseline (exit 1 on drift)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${TMPDIR:-/tmp}/pinball-verify"
mkdir -p "$OUT"
npx esbuild tools/snapshot.mts --bundle --platform=node --format=esm \
  --outfile="$OUT/snap.mjs" --log-level=warning
npx esbuild tools/replay.mts --bundle --platform=node --format=esm \
  --outfile="$OUT/rep.mjs" --log-level=warning
node "$OUT/snap.mjs" > "$OUT/snapshot.json"
node "$OUT/rep.mjs"  > "$OUT/replay.json"

case "${1:-show}" in
  save)  cp "$OUT/snapshot.json" "$OUT/$2.snapshot.json"
         cp "$OUT/replay.json"   "$OUT/$2.replay.json"
         echo "baseline '$2' saved" ;;
  check) ok=0
         cmp -s "$OUT/snapshot.json" "$OUT/$2.snapshot.json" \
           && echo "snapshot: identical" || { echo "snapshot: DIFFERS"; ok=1; }
         cmp -s "$OUT/replay.json" "$OUT/$2.replay.json" \
           && echo "replay:   identical" || { echo "replay:   DIFFERS"; ok=1; }
         exit $ok ;;
  *)     node -e "
           const s=require('$OUT/snapshot.json'), r=require('$OUT/replay.json');
           console.log('bodies', s.bodies.length, 'constraints', s.constraints.length);
           console.log('trajectory digest', r.digest);
           console.log('event digest     ', r.eventDigest, '(' + r.eventCount + ' events)');
         " ;;
esac
