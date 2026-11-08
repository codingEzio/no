# Page control icons

These 16 project-authored SVGs are the editable source for Calmly's Nothing page
controls. Each uses a 24 × 24 canvas, 2 px currentColor stroke, square caps and
stepped geometry. They are original navigation/control pictograms, not Nothing
brand artwork or an external icon dependency.

Desktop X embeds the path geometry in `calmly/extension_chrome/content.js`.
Android VIA embeds the required SVG bytes as CSS masks in its self-contained
userscript. Both retain host labels, action handlers, selected state and avatar
image identity. Original/Classic appearance restores its existing controls.

Asset parity, rendered optical size and actual host mask rendering are separate
checks. The page controls are independent of `../icons/`, which owns extension
popup controls. Source changes must update both embedded consumers and their
scoped visual evidence.
