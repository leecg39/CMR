#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if [[ ! -f .env ]]; then
  echo '먼저 터미널에서 npm install, npm run setup, npm run seed를 실행하세요.'
  exit 1
fi
if [[ ! -d dist/console ]]; then
  npm run build || exit 1
fi
node --import tsx apps/worker/main.ts &
CMP_WORKER_PID=$!
trap 'kill "$CMP_WORKER_PID" 2>/dev/null' EXIT INT TERM
printf '\n이음 콘솔: http://127.0.0.1:4310\n종료: Control+C\n\n'
node --import tsx apps/api/server.ts
