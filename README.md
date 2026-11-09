# no

<p><img src="extension_chrome/icons/icon-128.png" width="96" height="96" alt="no"></p>

The blocking page uses the system font by default; choose GlyphgrovePixel or GlyphgroveDeparture in extension options.

[English](README.md) · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md)

## Overview

no is a Chrome extension that blocks chosen domains with a full-window NO ✋.
Chrome version 0.99.1 keeps the existing public-key-pinned identity and saved
settings. Add domains or HTTP(S) URLs in the popup, enable the desired entries,
and select Save. The interface distinguishes saved-and-applied rules from local
settings whose rules are still pending; Save retries pending rules. Website
access must be allowed in Chrome's extension settings for blocking to work.
English, Simplified Chinese and Traditional Chinese are included.

## Use and maintenance

Load this checkout's `extension_chrome/` directory with Chrome's **Load
unpacked** action. No workspace hub or symbolic link is required. An existing
installation should retain its extension identity and storage; do not replace
its key or delete its saved settings to update it.

On macOS, install Deno 2.x and Git, then run:

```sh
deno task check
deno task build
```

Checks use synthetic local fixtures. Build writes a Chrome candidate under
ignored `Local/candidates/` and reads back its exact file hashes. It does not
install an extension, open a browser or run a service. Local verification may
read the private defaults file; regular and public packages exclude it. Complete
matching candidates are verified and reused; other candidates are preserved.
`extension_chrome/` is editable runtime source. `dependencies.lock.json`
identifies pinned generated inputs and their owners. Normal checks/builds read
local copies, not sibling checkouts. See
[dependencies](DEPENDENCIES.md).

Change a dependency at its recorded source owner, then explicitly sync reviewed
inputs and keep the resulting hashes and files together:

```sh
deno task deps:sync --owner=X-ExtShared --workspace=/absolute/path/to/source-workspace
deno task check
```

Desktop macOS Safari source metadata is also 0.99.0. Its retained runtime has
separate native source, generation and signing requirements; Chrome packaging
does not prove Safari installation or runtime behavior. Firefox delivery remains
paused. No command above resumes either port.

## Build a copied source candidate

A copied source candidate excludes private operational documents. The current
lock does not require the private Firefox README or PLAN; all listed pins remain
subject to verification. In a copied candidate, run:

```sh
deno task check
deno task public:build
```

The independent path verifies all selected dependency pins, fonts, the Safari
font manifest pin, manifest resources and the pinned Chrome ID. When present,
`SOURCE-RECEIPT.json` is checked against every selected file and its seal;
the output reports whether the receipt was verified or absent. This detects
copy changes but does not authenticate the source: compare its seal with the
trusted review record. A missing or changed runtime/build pin still fails. It
writes an immutable Chrome
candidate and relative-path receipt under `Local/public-build/`. Repeating it
verifies the same output without overwriting mismatches. It needs neither Git
history nor sibling checkouts and does not build or activate Firefox.

## Local source review

`public-source.json` selects the exact source payload. Stage intended named
files, then run:

```sh
deno task maintenance
deno task public:prepare
```

The export reads the Git index, excludes private operational records and Git
history, and creates an immutable candidate under ignored
`Local/public-source/`. Its receipt uses relative paths. Repeating preparation
verifies exact files, bytes and modes; mismatches fail without overwriting a
candidate. `public:check` is read-only. Symlinks and limited sensitive-content
patterns are rejected; this is not universal secret detection or a full history
review.

Project-owned code in this release is licensed under
[GNU GPL version 3 only](LICENSE) (`GPL-3.0-only`), copyright 2026 X-ExtNo
contributors. [License scope](LICENSE-SCOPE.md) preserves the earlier MIT grant
as historical provenance. Bundled fonts and third-party assets retain their own
terms; all existing licenses, notices and authorship remain in force. The owner authorizes this source selection for publication. Third-party terms and notices remain applicable. These commands do not publish or install software.

Desktop Safari retains its own 0.99.0 source; Chrome private-default handling
has not been synchronized or validated there. The previously reviewed classic worker parses. Popup CSS now follows Chrome's System sans
fallback. The full owner checkout retains earlier typography-script/default
metadata, so this narrow fix does not migrate stored typography or claim full
Safari sync. Independent native host regeneration also needs icon inputs outside
the selected source. The manifest declares DNR redirect and host access, but
installed site permission, actual redirects, Service Worker fallback and
performance still need separate Safari acceptance.

The isolated candidate uses new Firefox add-on IDs without personal naming. They
are separate identities and cannot upgrade existing Firefox installations in place.
The Firefox adapter is pinned from shared source; the builder is a no-maintained
derivative with private-file exclusion and fresh-target checks. Shared owner
sources remain unchanged.

This candidate also generalizes shared design review notes and updates its local
lock; source assets and license notices remain unchanged.

New installations of this candidate start with an empty blocked-domain list.
Users can add domains; existing saved rules are retained by the storage migration.

### Optional private defaults

A fresh public checkout has an empty block list. To use private defaults when loading `extension_chrome/` directly, create the ignored file `extension_chrome/private-defaults.json` with `{"domains":["example.com"]}` and reload the extension. The file is data, not executable code, and is excluded from source exports and Chrome, Safari and Firefox packages. Existing saved settings always win. When settings are absent, existing dynamic rules are preserved and take precedence. Without either, a missing or unreadable file gives an empty default; invalid JSON is reported. A separate private candidate can still be made from `Local/private-defaults.json` using `deno task private:build`. Safari and Firefox do not use these Chrome defaults.
