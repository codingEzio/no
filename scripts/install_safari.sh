#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
only=""
prepared_source=0
usage() {
  echo "usage: install_safari.sh [--only ID] [--prepared-source]" >&2
  exit 2
}
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --only)
      [[ "$#" -ge 2 && -z "$only" && -n "$2" && "$2" != --* ]] || usage
      only="$2"
      shift 2
      ;;
    --prepared-source)
      [[ "$prepared_source" -eq 0 ]] || usage
      prepared_source=1
      shift
      ;;
    *) usage ;;
  esac
done
[[ "$prepared_source" -eq 0 || -n "$only" ]] || {
  echo "--prepared-source requires an explicit --only ID" >&2
  exit 2
}

status_args=()
[[ -z "$only" ]] || status_args=(--only "$only")
build_args=("${status_args[@]}")
[[ "$prepared_source" -eq 0 ]] || build_args+=(--prepared-source)
"$root/scripts/build_safari.sh" "${build_args[@]}"

stamp=$(/bin/date -u +%Y%m%dT%H%M%SZ)
stage="$root/Local/SafariBuild/stage/$stamp"
backup="$root/Local/SafariBuild/backups/$stamp"
/bin/mkdir -p "$stage" "$backup" "$HOME/Applications"
registry_file="$(mktemp /private/tmp/delete_after_use_safari_install_registry.XXXXXX)"
deno run --allow-read "$root/scripts/sync_safari.ts" --list --check > "$registry_file"
cleanup_install_copies() {
  local id source_root web_root host_root app_name install_app host_id extension_id handler
  while IFS=$'\t' read -r id source_root web_root host_root app_name install_app host_id extension_id handler; do
    [[ -z "$only" || "$id" == "$only" ]] || continue
    # Keep recovery files, but not their Launch Services / Safari registrations.
    # These hosts may be visible to Launch Services without a pluginkit entry.
    "$root/scripts/forget-safari-build-copy.sh" \
      "$stage/$id/$install_app" "$HOME/Applications/$install_app" "$extension_id" || true
    "$root/scripts/forget-safari-build-copy.sh" \
      "$backup/$install_app" "$HOME/Applications/$install_app" "$extension_id" || true
  done < "$registry_file"
  /bin/rm -f "$registry_file"
}
trap cleanup_install_copies EXIT

# Verify every candidate before replacing any installed app.
while IFS=$'\t' read -r id source_root web_root host_root app_name install_app host_id extension_id handler; do
  [[ -z "$only" || "$id" == "$only" ]] || continue
  built="$root/Local/SafariBuild/DerivedData/$id/Build/Products/Release/$install_app"
  candidate="$stage/$id/$install_app"
  /bin/mkdir -p "$stage/$id"
  /usr/bin/ditto "$built" "$candidate"
  /usr/bin/codesign --verify --deep --strict "$candidate"
done < "$registry_file"

while IFS=$'\t' read -r id source_root web_root host_root app_name install_app host_id extension_id handler; do
  [[ -z "$only" || "$id" == "$only" ]] || continue
  candidate="$stage/$id/$install_app"
  installed="$HOME/Applications/$install_app"
  incoming="$HOME/Applications/.${install_app}.installing-$$"
  previous="$backup/$install_app"

  /usr/bin/ditto "$candidate" "$incoming"
  /usr/bin/codesign --verify --deep --strict "$incoming"
  /usr/bin/killall "$app_name" >/dev/null 2>&1 || true
  if [[ -d "$installed" ]]; then
    /bin/mv "$installed" "$previous"
  fi
  if ! /bin/mv "$incoming" "$installed"; then
    [[ ! -d "$previous" ]] || /bin/mv "$previous" "$installed"
    exit 1
  fi
  if ! /usr/bin/codesign --verify --deep --strict "$installed"; then
    /bin/mv "$installed" "$stage/$id/failed-$install_app"
    [[ ! -d "$previous" ]] || /bin/mv "$previous" "$installed"
    exit 1
  fi
  lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  "$lsregister" -f "$installed" >/dev/null
  /usr/bin/open -gj "$installed" --args --register-and-quit
  "$root/scripts/forget-safari-build-copy.sh" \
    "$root/Local/SafariBuild/DerivedData/$id/Build/Products/Release/$install_app" \
    "$installed"
  echo "installed: $installed"
done < "$registry_file"

cleanup_install_copies
trap - EXIT
"$root/scripts/safari_status.sh" --strict "${status_args[@]}"
