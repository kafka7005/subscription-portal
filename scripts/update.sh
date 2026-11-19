#!/usr/bin/env bash
# Update an installed portal. The live directory may be a running Caddy bind mount.
set -euo pipefail
die() { printf '%s\n' "$*" >&2; exit 1; }
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root"
mode=update
target="$root/dist"
while (($#)); do
  case $1 in
    --check|--rollback) [[ $mode == update ]] || die 'Выберите один режим.'; mode=${1#--}; shift ;;
    --web-root) [[ $# -ge 2 && -n $2 ]] || die 'Укажите каталог сайта.'; target=$2; shift 2 ;;
    --help) echo 'bash scripts/update.sh [--check | --rollback] [--web-root /srv/subscription-portal]'; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done

state="$root/.portal-update"
install -d -m 700 "$state"
exec 9>"$state/lock"
flock -n 9 || die 'Обновление уже выполняется.'
if [[ $mode != rollback ]]; then
  upstream=$(git rev-parse --symbolic-full-name '@{upstream}') || die 'Нужен Git-клон с настроенной upstream-веткой.'
  branch=$(git symbolic-ref --short HEAD)
  git fetch "$(git config --get "branch.$branch.remote")"
  git rev-list --left-right --count "HEAD...$upstream" | awk '{print "Локальных коммитов:",$1,"· новых в источнике:",$2}'
  if [[ $mode == check ]]; then exit 0; fi
fi

target=$(realpath -e "$target") || die 'Укажите каталог работающей установки.'
[[ -s "$target/index.html" && -s "$target/manifest-admin.webmanifest" ]] || die 'Не найдена установленная статика портала.'
[[ $state/ != "$target/"* && $target/ != "$state/"* ]] || die 'Хранилище копий должно быть вне каталога сайта.'
[[ -w $target ]] || die 'Пользователю установки нужна запись в каталог сайта.'
command -v rsync >/dev/null || die 'Установите rsync.'
# Keep old hashed chunks for tabs already open. Replace the entry point last.
publish() {
  rsync -rlt --checksum --chmod=D755,F644 --delay-updates --exclude='/index.html' "$1/" "$target/" &&
  rsync -rt --checksum --chmod=F644 "$1/index.html" "$target/index.html" &&
  cmp -s "$1/index.html" "$target/index.html"
}
if [[ $mode == rollback ]]; then
  [[ -f "$state/previous/target" && -s "$state/previous/dist/index.html" ]] || die 'Нет сохранённой версии.'
  [[ $(cat "$state/previous/target") == "$target" ]] || die 'Укажите тот же --web-root, что при обновлении.'
  publish "$state/previous/dist"
  echo 'Предыдущая сборка восстановлена.'
  exit 0
fi

[[ -s .env ]] || die 'Не найден файл .env этой установки.'
before=$(git rev-parse HEAD)
git merge --ff-only "$upstream"
if ! git diff --quiet "$before" HEAD -- bot-module; then
  echo 'В этой версии изменился модуль бота. Проверьте раздел 4 README на сервере бота.'
fi
stage=$(mktemp -d "$state/build.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then docker_cmd=(sudo docker); fi
"${docker_cmd[@]}" run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$root:/app" -v "$stage:/output" -w /app node:24-bookworm-slim \
  sh -ec 'npm ci && npm test && npm run build -- --outDir /output'
[[ -s "$stage/index.html" && -s "$stage/manifest-admin.webmanifest" && -d "$stage/assets" ]] || die 'Сборка неполная.'
backup=$(mktemp -d "$state/backup.XXXXXXXX")
mkdir "$backup/dist"
cp -a "$target/." "$backup/dist/"
printf '%s\n' "$target" > "$backup/target"
ln -s "$(basename "$backup")" "$backup/previous-link"
mv -Tf "$backup/previous-link" "$state/previous"
if ! publish "$stage"; then
  echo 'Ошибка публикации. Восстанавливаю предыдущую сборку.' >&2
  publish "$backup/dist" || die "Требуется восстановление из $backup/dist"
  exit 1
fi
printf 'Сайт обновлён до %s. Копия: %s\n' "$(git rev-parse --short HEAD)" "$backup"
