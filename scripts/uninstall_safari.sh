#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
only=""
if [[ "$#" -gt 0 ]]; then
  [[ "$#" -eq 2 && "$1" == "--only" ]] || { echo "usage: uninstall_safari.sh [--only ID]" >&2; exit 2; }
  only="$2"
fi

stamp=$(/bin/date -u +%Y%m%dT%H%M%SZ)
recovery="$root/Local/SafariBuild/uninstalled/$stamp"
/bin/mkdir -p "$recovery"
registry_file="$(mktemp /private/tmp/delete_after_use_safari_uninstall_registry.XXXXXX)"
deno run --allow-read "$root/scripts/sync_safari.ts" --list > "$registry_file"
trap '/bin/rm -f "$registry_file"' EXIT

while IFS=$'\t' read -r id source_root web_root host_root app_name install_app host_id extension_id handler; do
  [[ -z "$only" || "$id" == "$only" ]] || continue
  installed="$HOME/Applications/$install_app"
  /usr/bin/killall "$app_name" >/dev/null 2>&1 || true
  [[ ! -d "$installed" ]] || /bin/mv "$installed" "$recovery/$install_app"
  "$root/scripts/forget-safari-build-copy.sh" \
    "$root/Local/SafariBuild/DerivedData/$id/Build/Products/Release/$install_app" \
    "$installed" \
    "$extension_id"
  echo "uninstalled: $id (recoverable at $recovery)"
done < "$registry_file"

trap - EXIT
/bin/rm -f "$registry_file"
