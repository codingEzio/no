# GlyphgrovePixel — Web

Project package. It includes variable Rysana-derived Latin, Cubic-derived pixel CJK, complete Nerd symbols and Noto 3D Emoji; normal and italic share CJK, icons and emoji. Chinese outlines are fixed weight. Fonts load on demand; missing characters use system fallback.

```html
<link rel="stylesheet" href="fonts.css">
<p class="glyphgrove-pixel">Hello 中文  <span class="glyphgrove-emoji">👩🏽‍💻 1️⃣</span></p>
```

The family can also be selected as `"GlyphgrovePixel"`. Use `.glyphgrove-emoji` for complete sequences such as keycaps. The emoji font uses sbix: the package was checked in macOS Chrome; other platforms and browsers have not been verified and may use system emoji. Latin uses a 570-unit cell; Han uses 1106, so fixed-grid terminal alignment may differ. Serve WOFF2 with `font/woff2` and suitable versioned caching. Keep `NOTICE.md` and `licenses/` with the files. See NOTICE.md for unresolved provenance questions.
