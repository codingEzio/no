#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
only="${1:-}"
registry_file="$(mktemp /private/tmp/delete_after_use_safari_settings_registry.XXXXXX)"
deno run --allow-read "$root/scripts/sync_safari.ts" --list > "$registry_file"
trap '/bin/rm -f "$registry_file"' EXIT

while IFS=$'\t' read -r id source_root web_root host_root app_name install_app host_id extension_id handler; do
  [[ -z "$only" || "$id" == "$only" ]] || continue
  installed="$HOME/Applications/$install_app"
  [[ -d "$installed" ]] || { echo "Safari host is not installed: $id" >&2; exit 1; }
  /usr/bin/open -W -gj -n "$installed" --args --open-safari-settings
  exit 0
done < "$registry_file"

echo "Unknown Safari build id: $only" >&2
exit 2
