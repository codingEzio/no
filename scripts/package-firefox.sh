#!/bin/sh
set -eu
mkdir -p Local/firefox-android
output=$(mktemp -d Local/firefox-android/candidate.XXXXXX)
zip_path=$(command -v zip)
case "$zip_path" in /*/zip) ;; *) echo "Native zip must resolve to an absolute executable path" >&2; exit 1 ;; esac
env -u LD_PRELOAD deno run --allow-read --allow-write=Local --allow-run=zip,/system/bin/linker64 extension_firefox/build_extensions.ts "$output" "--zip-path=$zip_path"
