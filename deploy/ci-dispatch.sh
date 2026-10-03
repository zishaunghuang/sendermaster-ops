#!/usr/bin/env bash
set -euo pipefail
# OpenSSH forced command: this identity has no interactive shell or file upload API.
if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^release\ ([a-f0-9]{40})$ ]]; then
  exec sudo -n /usr/local/sbin/sendermaster-ops-release "${BASH_REMATCH[1]}"
fi
printf 'Only release <40-character main commit SHA> is allowed.\n' >&2
exit 64
