#!/usr/bin/env bash
set -euo pipefail
# Run as the dedicated deployment account after fetching an explicitly approved tag.
# Never run this in robot_store, and never restart any merchant service.
test "$(node -p 'require("./package.json").name')" = sendermaster-ops
npm ci
npm test
npm run build
npm run db:deploy
sudo systemctl restart sendermaster-ops
curl --fail --silent --show-error http://127.0.0.1:3010/ > /dev/null
