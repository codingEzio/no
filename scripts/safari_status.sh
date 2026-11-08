#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
strict=0
only=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --strict) strict=1; shift ;;
    --only) [[ "$#" -ge 2 ]] || { echo "--only needs an ID" >&2; exit 2; }; only="$2"; shift 2 ;;
    *) echo "usage: safari_status.sh [--strict] [--only ID]" >&2; exit 2 ;;
  esac
done

registry_file="$(mktemp /private/tmp/delete_after_use_safari_status_registry.XXXXXX)"
registrations="$(mktemp /private/tmp/delete_after_use_safari_registrations.XXXXXX)"
deno run --allow-read "$root/scripts/sync_safari.ts" --list --check > "$registry_file"
trap '/bin/rm -f "$registry_file" "$registrations"' EXIT
failed=0

refresh_registrations() {
  /usr/bin/pluginkit -mAvvv -p com.apple.Safari.web-extension > "$registrations" 2>/dev/null || true
}

registered_paths() {
  /usr/bin/awk -v id="$1" '
    index($0, id) { keep = 1; next }
    keep && $1 == "Path" { sub(/^[[:space:]]*Path =[[:space:]]*/, ""); print; keep = 0 }
  ' "$registrations"
}

refresh_registrations

while IFS=$'\t' read -r id source_root web_root host_root app_name install_app host_id extension_id handler; do
  [[ -z "$only" || "$id" == "$only" ]] || continue
  installed="$HOME/Applications/$install_app"
  paths=$(registered_paths "$extension_id")
  count=$(print -r -- "$paths" | /usr/bin/awk 'NF { count += 1 } END { print count + 0 }')
  expected=$(/usr/bin/find "$installed/Contents/PlugIns" -maxdepth 1 -name '*.appex' -type d -print -quit 2>/dev/null || true)
  if [[ "$strict" -eq 1 && -n "$expected" ]]; then
    for attempt in {1..20}; do
      [[ "$count" -eq 1 && "$paths" == "$expected" ]] && break
      /bin/sleep 0.25
      refresh_registrations
      paths=$(registered_paths "$extension_id")
      count=$(print -r -- "$paths" | /usr/bin/awk 'NF { count += 1 } END { print count + 0 }')
    done
  fi
  state='{"enabled":null,"error":"host not installed"}'
  executable=""
  if [[ -d "$installed" ]]; then
    executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$installed/Contents/Info.plist" 2>/dev/null || true)
    nonce=$(/usr/bin/uuidgen)
    cache="$HOME/Library/Containers/$host_id/Data/Library/Caches/SafariExtensionStatus.json"
    if /usr/bin/open -gj -n "$installed" --args --safari-status-cache --status-nonce "$nonce"; then
      for attempt in {1..20}; do
        if [[ -f "$cache" ]] && /usr/bin/grep -Fq "\"nonce\":\"$nonce\"" "$cache" 2>/dev/null; then
          state=$(/bin/cat "$cache")
          break
        fi
        /bin/sleep 0.25
      done
    fi
    if [[ "$state" != *"\"nonce\":\"$nonce\""* && -n "$executable" && -x "$installed/Contents/MacOS/$executable" ]]; then
      # Some callers cannot read TCC-protected container caches; the host
      # prints the same JSON on stdout from a direct invocation.
      direct_state=$("$installed/Contents/MacOS/$executable" --safari-status-json 2>/dev/null || true)
      [[ "$direct_state" == *"\"extensionBundleIdentifier\":\"$extension_id\""* ]] && state="$direct_state"
    fi
    if [[ "$state" != *"\"nonce\":\"$nonce\""* && "$state" != *"\"extensionBundleIdentifier\":\"$extension_id\""* ]]; then
      state='{"enabled":null,"error":"host status query failed"}'
    fi
  fi
  bridge="not-applicable"
  if [[ "$handler" == "atlaskit" && -d "$installed" ]]; then
    bridge_nonce=$(/usr/bin/uuidgen)
    bridge_cache="$HOME/Library/Containers/$host_id/Data/Library/Caches/SafariBridgeStatus.json"
    bridge="failed"
    if /usr/bin/open -gj -n "$installed" --args --bridge-self-test-cache --status-nonce "$bridge_nonce"; then
      for attempt in {1..40}; do
        if [[ -f "$bridge_cache" ]] && /usr/bin/grep -Fq "\"nonce\":\"$bridge_nonce\"" "$bridge_cache" 2>/dev/null; then
          /usr/bin/grep -Fq '"bridge":"ready"' "$bridge_cache" 2>/dev/null && bridge="ready"
          break
        fi
        /bin/sleep 0.25
      done
    fi
    if [[ "$bridge" != "ready" && -n "$executable" && -x "$installed/Contents/MacOS/$executable" ]]; then
      # Same fallback: the direct binary prints its bridge self-test JSON.
      if "$installed/Contents/MacOS/$executable" --bridge-self-test >/dev/null 2>&1; then
        bridge="ready"
      fi
    fi
  fi
  echo "$id registrations=$count expected=${expected:-missing} state=$state bridge=$bridge"
  if [[ "$strict" -eq 1 && ( "$count" -ne 1 || -z "$expected" || "$paths" != "$expected" || "$state" != *"\"extensionBundleIdentifier\":\"$extension_id\""* || ( "$handler" == "atlaskit" && "$bridge" != "ready" ) ) ]]; then
    failed=1
  fi
done < "$registry_file"

trap - EXIT
/bin/rm -f "$registry_file" "$registrations"
exit "$failed"
