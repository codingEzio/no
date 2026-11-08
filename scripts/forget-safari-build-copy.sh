#!/bin/zsh
set -euo pipefail

if [[ "$#" -lt 2 || "$#" -gt 3 ]]; then
  echo "usage: forget-safari-build-copy.sh BUILT.app INSTALLED.app [EXTENSION_BUNDLE_ID]" >&2
  exit 2
fi

built="$1"
installed="$2"
lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

[[ "$built" == *.app && "$installed" == "$HOME/Applications/"*.app ]] || {
  echo "refusing unexpected Safari app paths" >&2
  exit 2
}
[[ -x "$lsregister" ]] || { echo "lsregister is unavailable" >&2; exit 1; }

forget_copy() {
  local app="$1"
  local appex
  if [[ -d "$app" ]]; then
    while IFS= read -r appex; do
      /usr/bin/pluginkit -r "$appex" >/dev/null 2>&1 || true
      "$lsregister" -u "$appex" >/dev/null 2>&1 || true
    done < <(/usr/bin/find "$app" -name '*.appex' -type d 2>/dev/null)
  fi
  # Launch Services retains paths after their build/stage directory is gone.
  "$lsregister" -u "$app" >/dev/null 2>&1 || true
}

extension_id="${3:-}"
for app in "$installed" "$built"; do
  [[ -z "$extension_id" ]] || break
  appex=$(/usr/bin/find "$app/Contents/PlugIns" -maxdepth 1 -name '*.appex' -type d -print -quit 2>/dev/null || true)
  if [[ -n "$appex" ]]; then
    extension_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$appex/Contents/Info.plist" 2>/dev/null || true)
    [[ -n "$extension_id" ]] && break
  fi
done

forget_copy "$built"

if [[ -n "$extension_id" ]]; then
  installed_appex=$(/usr/bin/find "$installed/Contents/PlugIns" -maxdepth 1 -name '*.appex' -type d -print -quit 2>/dev/null || true)
  while IFS= read -r path; do
    [[ -n "$path" && "$path" != "$installed_appex" ]] || continue
    /usr/bin/pluginkit -r "$path" >/dev/null 2>&1 || true
    "$lsregister" -u "$path" >/dev/null 2>&1 || true
    parent="${path%/Contents/PlugIns/*}"
    [[ "$parent" == "$path" || "$parent" == "$installed" ]] || "$lsregister" -u "$parent" >/dev/null 2>&1 || true
  done < <(
    /usr/bin/pluginkit -mAvvv -p com.apple.Safari.web-extension 2>/dev/null |
      /usr/bin/awk -v id="$extension_id" '
        index($0, id) { keep = 1; next }
        keep && $1 == "Path" { sub(/^[[:space:]]*Path =[[:space:]]*/, ""); print; keep = 0 }
      '
  )
fi

[[ -d "$installed" ]] && "$lsregister" -f "$installed" >/dev/null 2>&1 || true
