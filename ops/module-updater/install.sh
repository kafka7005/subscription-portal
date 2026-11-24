#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 4 || $EUID != 0 ]]; then
  echo "Usage: sudo bash install.sh BOT_DIR BOT_UNIT LOCAL_API_PORT REPO_URL" >&2
  exit 2
fi
module=portal_custom_api
base="/var/lib/$module-updater"
bot_dir=$(realpath -e -- "$1")
unit=$2
port=$3
origin=$4
[[ $unit =~ ^[[:alnum:]_@.-]+\.service$ && $port =~ ^[1-9][0-9]{0,4}$ && $port -le 65535 ]]
[[ $bot_dir =~ ^/[a-zA-Z0-9_./-]+$ && -d "$bot_dir/modules/$module" && ! -L "$bot_dir/modules/$module" ]]
case "$origin" in https://*|git@*:*|ssh://*) ;; *) echo 'Use an HTTPS or SSH Git remote' >&2; exit 2;; esac
systemctl cat "$unit" >/dev/null
bot_user=$(systemctl show -p User --value "$unit")
src=$(cd -- "$(dirname -- "$0")" && pwd)
install -d -m 0711 "$base"
install -d -m 0700 "$base/private"
install -d -m 0700 -o "${bot_user:-root}" "$base/inbox"
if [[ $(stat -c %d "$base/private") != $(stat -c %d "$bot_dir/modules/$module") ]]; then
  echo 'State directory and module must be on the same filesystem.' >&2; exit 1
fi
repo="$base/private/source.git"
if [[ ! -d $repo ]]; then git init --bare --quiet "$repo"; fi
if git --git-dir="$repo" remote get-url origin >/dev/null 2>&1; then
  git --git-dir="$repo" remote set-url origin "$origin"
else
  git --git-dir="$repo" remote add origin "$origin"
fi
export GIT_TERMINAL_PROMPT=0
git --git-dir="$repo" fetch --quiet --no-tags origin refs/heads/main
git --git-dir="$repo" cat-file -e "FETCH_HEAD:bot-module/$module/VERSION"
install -m 0755 "$src/worker.py" "$base/private/worker.py"
python3 - "$base" "$bot_dir/modules/$module" "$unit" "$port" <<'PY'
import json,sys
from pathlib import Path
(Path(sys.argv[1])/'config.json').write_text(json.dumps(dict(target=sys.argv[2],unit=sys.argv[3],port=int(sys.argv[4]))))
PY
name="$module-updater"
cat >"/etc/systemd/system/$name.service" <<UNIT
[Unit]
Description=Check and apply approved module updates
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -B $base/private/worker.py
Environment=GIT_TERMINAL_PROMPT=0
UMask=0022
PrivateTmp=yes
NoNewPrivileges=yes
ProtectSystem=full
TimeoutStartSec=8min
UNIT
cat >"/etc/systemd/system/$name.timer" <<UNIT
[Unit]
Description=Process the module update queue
[Timer]
OnBootSec=15s
OnUnitInactiveSec=10s
AccuracySec=1s
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now "$name.timer"
systemctl start "$name.service"
