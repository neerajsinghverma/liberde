#!/usr/bin/env bash
# Guarded production deploy. Refuses to run unless we are in liberde-cloud AND
# the folder is linked to the real "liberde" Vercel project — so a stray cwd
# can never ship the wrong codebase (it happened; see README "Deploying").
set -euo pipefail
cd "$(dirname "$0")/.."

EXPECTED_PROJECT="prj_qL9D9hkzw3TbZPGsMWkeSQ4iGi0s"

case "$(pwd)" in
  */liberde-cloud) ;;
  *) echo "REFUSING: not in liberde-cloud (pwd: $(pwd))" >&2; exit 1 ;;
esac
if [ ! -f lib/db.ts ] || ! grep -q "@neondatabase/serverless" lib/db.ts; then
  echo "REFUSING: this folder is not the Neon (cloud) codebase" >&2; exit 1
fi
ACTUAL=$(node -e "console.log(require('./.vercel/project.json').projectId)" 2>/dev/null || echo missing)
if [ "$ACTUAL" != "$EXPECTED_PROJECT" ]; then
  echo "REFUSING: .vercel link is '$ACTUAL', expected '$EXPECTED_PROJECT'" >&2; exit 1
fi

npx next build
npx vercel --prod
