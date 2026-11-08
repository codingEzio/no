# GlyphgrovePixel — Web

供本機私有專案使用。包含可變英文字形、像素中文、完整 Nerd 圖示和 Noto 3D Emoji；正常體和斜體共用中文、圖示與 Emoji。中文字形為固定字重。字型按需載入，缺字由系統字型補充。

```html
<link rel="stylesheet" href="fonts.css">
<p class="glyphgrove-pixel">Hello 中文  <span class="glyphgrove-emoji">👩🏽‍💻 1️⃣</span></p>
```

也可以直接指定字型家族 `"GlyphgrovePixel"`。數字鍵帽等完整 Emoji 序列使用 `.glyphgrove-emoji`。Emoji 字型使用 sbix：已在 macOS Chrome 驗證，其他平台和瀏覽器未測，可能回退至系統 Emoji。英文單格為 570，漢字為 1106；固定網格終端機的對齊可能不同。伺服器應以 `font/woff2` 提供字型並設定適合版本更新的快取。保留 `NOTICE.md` 和 `licenses/`；未解決的來源問題見 NOTICE.md。
