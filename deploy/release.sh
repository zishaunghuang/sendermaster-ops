#!/usr/bin/env bash
set -euo pipefail
umask 022
# Install root-owned at /usr/local/sbin/sendermaster-ops-release.
# Receives a prebuilt artifact on stdin; never executes repository scripts as root.
[[ $# = 1 && "$1" =~ ^[a-f0-9]{40}$ ]] || exit 64
[[ $(id -u) = 0 ]] || { echo 'Release helper must be invoked by the restricted sudo rule.' >&2; exit 77; }
revision=$1
base=/var/sofi/sendermaster-ops
releases=$base/releases
current=$base/current
node=/opt/sendermaster-ops/runtime/bin/node
cd "$base"
exec 9>/run/lock/sendermaster-ops-release.lock
flock -w 900 9
main_revision=$(timeout 60 git -c credential.helper= -c core.hooksPath=/dev/null ls-remote https://github.com/zishaunghuang/sendermaster-ops.git refs/heads/main | awk '{print $1}')
[[ "$main_revision" = "$revision" ]] || { echo 'Refusing a commit that is no longer the remote main head.' >&2; exit 75; }
[[ -f /etc/sendermaster-ops/environment && -x "$node" ]] || exit 78
install -d -m 0755 "$releases"
staging=$(mktemp -d "$releases/.incoming-$revision-XXXXXX")
chown sendermaster-ops-deploy:sendermaster-ops "$staging"
chmod 0750 "$staging"
previous=$(readlink -f "$current")
[[ -d "$previous" && -f "$previous/.next/BUILD_ID" ]] || exit 78
switched=0
release=""
cleanup() {
  result=$?
  trap - EXIT
  if (( result != 0 && switched == 1 )); then
    echo 'Deployment check failed; restoring previous application version.' >&2
    ln -s "$previous" "$base/.current-rollback-$$"
    mv -Tf "$base/.current-rollback-$$" "$current"
    systemctl restart sendermaster-ops || true
    logger -t sendermaster-ops-release "FAILED $revision; restored $previous"
  fi
  [[ ! -d "$staging" ]] || rm -rf -- "$staging"
  exit "$result"
}
trap cleanup EXIT
runuser -u sendermaster-ops-deploy -- tar --extract --gzip --file=- --directory="$staging" --no-same-owner --no-same-permissions
[[ -f "$staging/deploy/REVISION" && $(cat "$staging/deploy/REVISION") = "$revision" ]]
[[ -s "$staging/.next/BUILD_ID" && -f "$staging/node_modules/prisma/build/index.js" ]]
[[ -s "$staging/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x" && -s "$staging/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node" ]] || { echo "Production OpenSSL 3 Prisma engines are missing from the artifact." >&2; exit 65; }
"$node" -e 'if(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).name!=="sendermaster-ops") process.exit(1)' "$staging/package.json"
# Refuse artifact-supplied production environment files; these live only on the server.
if find "$staging" -maxdepth 1 -name '.env*' -print -quit | grep -q .; then
  echo 'Environment files are forbidden in the release artifact.' >&2; exit 65
fi
release="$releases/$revision-$(date +%s)"
mv "$staging" "$release"
chown -R root:sendermaster-ops "$release"
install -d -m 0750 -o sendermaster-ops -g sendermaster-ops "$release/.next/cache"
# Back up only the independent ops DB before migrations. Do not auto-restore the DB on rollback.
install -d -m 0700 /var/backups/sendermaster-ops
backup="/var/backups/sendermaster-ops/before-$revision-$(date +%s).dump"
( umask 077; runuser -u postgres -- pg_dump -Fc --dbname=sendermaster_ops > "$backup" )
"$node" /usr/local/libexec/sendermaster-ops-runtime-task.cjs migrate "$release"
ln -s "$release" "$base/.current-next-$$"
mv -Tf "$base/.current-next-$$" "$current"
switched=1
systemctl restart sendermaster-ops
for attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3010/ >/dev/null; then break; fi
  if [[ "$attempt" = 30 ]]; then echo 'Application failed to start.' >&2; exit 1; fi
  sleep 1
done
systemctl is-active --quiet sendermaster-ops
"$node" /usr/local/libexec/sendermaster-ops-runtime-task.cjs verify "$release"
printf '%s\n' "$revision" > "$base/.deployed-revision"
logger -t sendermaster-ops-release "SUCCEEDED $revision"
echo "Released $revision; independent ops database and signed core health verified."
# Retain the five latest successful/failed artifact directories plus the previous/current targets.
python3 - "$releases" "$release" "$previous" <<'RETENTION'
from pathlib import Path
import re, shutil, sys
root=Path(sys.argv[1]); protected={Path(p).resolve() for p in sys.argv[2:]}
items=sorted((p for p in root.iterdir() if p.is_dir() and not p.is_symlink() and re.fullmatch(r'[a-f0-9]{40}-[0-9]+',p.name)),key=lambda p:p.stat().st_mtime,reverse=True)
for p in items[5:]:
    if p.resolve() not in protected: shutil.rmtree(p)
RETENTION
