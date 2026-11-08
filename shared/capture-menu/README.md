# Capture menu core

Canonical first-party parser/editor/styles shared by Bookmark and Journal.
Product adapters own category/tag/lifecycle validation and persisted route
selection. `scripts/sync_capture_menu.ts` materializes byte-identical copies
into the two independent Chrome roots; Safari generation invokes that helper.
Edit this canonical source, never introduce a divergent adapter copy. Existing
eight locale catalogs retain menu* labels; Journal uses category wording for
catalog refresh. No runtime package/dependency, network requirement or new
native bridge.
