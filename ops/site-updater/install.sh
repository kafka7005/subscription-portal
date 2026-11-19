#!/usr/bin/env bash
# Run once as root. Install from the trusted checkout, never from an HTTP request.
set -euo pipefail
[[ $(id -u) == 0 && $# -ge 3 && $# -le 4 ]] || { echo 'Usage: sudo bash install.sh https://site.example /absolute/checkout /absolute/web-root [fixed-publisher]'; exit 2; }
origin=$1
[[ $origin =~ ^https://[a-zA-Z0-9.-]+$ ]] || exit 2
here=$(cd "$(dirname "$0")" && pwd)
source_dir=$(realpath -e "$2")
# Keep the stable path when releases/current is a symlink.
root=$3
[[ -s "$root/index.html" ]] || { echo 'Укажите каталог действующего сайта'; exit 2; }
publisher=${4:-}
for path in "$source_dir" "$root" "$publisher"; do
  [[ -z $path || $path =~ ^/[a-zA-Z0-9_./-]+$ ]] || { echo 'Нужен абсолютный путь без пробелов'; exit 2; }
done
[[ -d "$source_dir/.git" && ( -z $publisher || -x $publisher ) ]] || exit 2
owner=$(stat -c %U "$source_dir/.git")
id portal-update-api >/dev/null 2>&1 || useradd --system --user-group --no-create-home --shell /usr/sbin/nologin portal-update-api
install -d -m 755 /usr/local/lib/portal-site-updater
install -m 644 "$here/api.py" "$here/worker.py" /usr/local/lib/portal-site-updater/
install -d -m 755 -o "$owner" /var/lib/portal-site-updater
install -d -m 770 -o "$owner" -g portal-update-api /var/lib/portal-site-updater/queue
echo 'd /run/portal-site-updater 0755 portal-update-api portal-update-api -' > /etc/tmpfiles.d/portal-site-updater.conf
systemd-tmpfiles --create /etc/tmpfiles.d/portal-site-updater.conf
cat >/etc/systemd/system/portal-update-api.service <<UNIT
[Unit]
Description=Portal administrator update gateway
After=network-online.target systemd-tmpfiles-setup.service
[Service]
User=portal-update-api
Environment=SITE_ORIGIN=$origin
ExecStart=/usr/bin/python3 /usr/local/lib/portal-site-updater/api.py
Restart=always
RestartSec=2
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/run/portal-site-updater /var/lib/portal-site-updater/queue
[Install]
WantedBy=multi-user.target
UNIT
cat >/etc/systemd/system/portal-update-worker.service <<UNIT
[Unit]
Description=Portal version checker and publisher
After=network-online.target docker.service
[Service]
User=$owner
SupplementaryGroups=docker
Environment=SOURCE_DIR=$source_dir SITE_ROOT=$root UPDATE_COMMAND=$publisher GIT_TERMINAL_PROMPT=0
ExecStart=/usr/bin/python3 /usr/local/lib/portal-site-updater/worker.py
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable portal-update-api portal-update-worker
systemctl restart portal-update-api portal-update-worker
