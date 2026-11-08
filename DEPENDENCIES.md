# Dependencies

- Deno 2.x and Git run source checks and Chrome packaging. The test source uses
  synthetic data; no browser profile, receiver, account or device is needed.
  macOS checks do not establish native Termux acceptance. There is no Node/npm
  executable requirement. Deno's lockfile records imported dependencies; a first
  cache fill can require network access.
- `dependencies.lock.json` records generated input owners, paths and hashes.
  Normal builds use local pinned copies, without sibling checkout lookup or
  automatic download. `deps:sync` explicitly accepts `--owner` and
  `--workspace`; its omitted workspace defaults to the parent directory for that
  update command only. Change the owner first, then sync and verify.
- Runtime fonts, icons, provenance and license notices are bundled locally.
  `scripts/calmly_package_guard.ts` verifies the existing browser manifest's
  exact font/notice asset hashes and sizes. The current catalog has seven text
  faces and separate default/Android emoji adapters. Font files and notices
  remain unchanged. `scripts/verify.ts` rejects removed font experiment filenames and runtime
  references in Chrome and retained Safari web source. The earlier cross-product
  removed font experiment build instruction does not apply to this runtime.
- `vendor/prometheus/removed font experiment_font_faces.json` is a pinned catalog of filenames,
  hashes and Unicode ranges, not a font binary or license grant. No removed font experiment
  font files are selected for export. Existing OFL, MIT, Apache, CC and other
  component terms remain attached to their corresponding assets; the project's
  GPL-3.0-only code license does not replace them.
- Safari requires its separate Xcode/XcodeGen workflow, signing and native-host
  setup. Private signing configuration belongs in ignored `Local/`; source
  selection does not supply it or establish native installation. Firefox's
  retained adapter uses native zip; its packaging and installation are outside
  these Chrome commands and remain paused.
- Source review/export uses Git and Deno. `scripts/public_prepare.ts` and its
  boundary fixture start from Tab Merge N Sort commit `e380e75`; No adds
  rejection of control characters in source paths and its own explicit
  selection. Its independent builder uses existing local file/hash helpers and
  the font guard, preserves the original strict verifier and lock, and exempts
  exactly the two excluded private Firefox documentation pins. No new runtime
  dependency is introduced.

Project-owned code in this release uses [GPL-3.0-only](LICENSE).
[License scope](LICENSE-SCOPE.md) retains the earlier MIT grant as historical
provenance. Preserve original authorship and all third-party notices. Source publication is authorized by the owner; this does not authorize installation, private uploads or changes to other projects.
