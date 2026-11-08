#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
only=""
prepared_source=0
usage() {
  echo "usage: build_safari.sh [--only ID] [--prepared-source]" >&2
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

source "$root/Local/signing/safari_identity.conf"
/usr/bin/security find-identity -v -p codesigning | /usr/bin/grep -Fq "\"$SIGNING_IDENTITY\"" || {
  echo "Signing identity not found: $SIGNING_IDENTITY" >&2
  exit 1
}

sync_args=()
[[ -z "$only" ]] || sync_args=(--only "$only")
if [[ "$prepared_source" -eq 1 ]]; then
  # Retain the reviewed Safari runtime. Stale native metadata must be prepared
  # explicitly too; the host generator also copies icons, so use check only.
  deno run --allow-read "$root/scripts/sync_safari.ts" --version-only --check "${sync_args[@]}"
  deno run --allow-read "$root/scripts/generate_safari_hosts.ts" --check "${sync_args[@]}"
else
  deno run --allow-read --allow-write "$root/scripts/sync_safari.ts" "${sync_args[@]}"
  deno run --allow-read --allow-write "$root/scripts/generate_safari_hosts.ts" "${sync_args[@]}"
  deno run --allow-read "$root/scripts/sync_safari.ts" --check "${sync_args[@]}"
  deno run --allow-read "$root/scripts/generate_safari_hosts.ts" --check "${sync_args[@]}"
fi
deno task verify

registry_file="$(mktemp /private/tmp/delete_after_use_safari_registry.XXXXXX)"
deno run --allow-read "$root/scripts/sync_safari.ts" --list --check > "$registry_file"
current_built=""
current_installed=""
cleanup() {
  [[ -z "$current_built" ]] || "$root/scripts/forget-safari-build-copy.sh" "$current_built" "$current_installed" || true
  /bin/rm -f "$registry_file"
}
trap cleanup EXIT

matched=0
while IFS=$'\t' read -r id source_root web_root host_root app_name install_app host_id extension_id handler; do
  [[ -z "$only" || "$id" == "$only" ]] || continue
  matched=1
  host="$root/$host_root"
  derived="$root/Local/SafariBuild/DerivedData/$id"
  project="$host/$app_name.xcodeproj"
  current_built="$derived/Build/Products/Release/$install_app"
  current_installed="$HOME/Applications/$install_app"

  /opt/homebrew/bin/xcodegen generate --spec "$host/project.yml" --project "$host" --project-root "$host" --quiet
  xcodebuild -quiet \
    -project "$project" \
    -scheme "$app_name" \
    -configuration Release \
    -derivedDataPath "$derived" \
    -destination 'platform=macOS,arch=arm64' \
    CODE_SIGN_IDENTITY="$SIGNING_IDENTITY" \
    CODE_SIGN_STYLE=Manual \
    DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
    build

  [[ -d "$current_built" ]] || { echo "$id: built app is missing" >&2; exit 1; }
  /usr/bin/codesign --verify --deep --strict "$current_built"
  actual_host=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$current_built/Contents/Info.plist")
  appex=$(/usr/bin/find "$current_built/Contents/PlugIns" -maxdepth 1 -name '*.appex' -type d -print -quit)
  actual_extension=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$appex/Contents/Info.plist")
  [[ "$actual_host" == "$host_id" && "$actual_extension" == "$extension_id" ]] || {
    echo "$id: built bundle identity mismatch" >&2
    exit 1
  }
  "$root/scripts/forget-safari-build-copy.sh" "$current_built" "$current_installed"
  current_built=""
  current_installed=""
  echo "built: $id"
done < "$registry_file"

[[ "$matched" -eq 1 ]] || { echo "Unknown Safari build id: $only" >&2; exit 2; }
