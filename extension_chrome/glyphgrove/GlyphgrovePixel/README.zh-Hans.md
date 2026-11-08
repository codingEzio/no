# GlyphgrovePixel — Web

供本机私有项目使用。包含可变英文字形、像素中文、完整 Nerd 图标和 Noto 3D Emoji；正常体和斜体共用中文、图标与 Emoji。中文字形为固定字重。字体按需加载，缺字由系统字体补充。

```html
<link rel="stylesheet" href="fonts.css">
<p class="glyphgrove-pixel">Hello 中文  <span class="glyphgrove-emoji">👩🏽‍💻 1️⃣</span></p>
```

也可以直接指定字体家族 `"GlyphgrovePixel"`。数字键帽等完整 Emoji 序列使用 `.glyphgrove-emoji`。Emoji 字体使用 sbix：已在 macOS Chrome 验证，其他平台和浏览器未测，可能回退到系统 Emoji。英文单格为 570，汉字为 1106；固定网格终端的对齐可能不同。服务器应以 `font/woff2` 提供字体并配置适合版本更新的缓存。保留 `NOTICE.md` 和 `licenses/`；未解决的来源问题见 NOTICE.md。
