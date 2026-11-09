# no

<p><img src="extension_chrome/icons/icon-128.png" width="96" height="96" alt="no"></p>

[English](README.md) · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md)

## 概览

选择域名，用全窗口的 NO ✋ 阻止访问。Chrome 源码版本0.99.1保留原来的扩展身份与设置。

## 使用

在 Chrome 的“加载已解压的扩展程序”中选择 extension_chrome/。在弹窗中添加域名或 HTTP(S) URL，启用所需条目并保存。允许扩展访问网站后，规则才可生效。界面区分“已保存并应用”和“已保存但规则待应用”，再次保存可重试。不要替换公钥或删除现有设置来更新。

## 平台限制

Chrome 是当前打包目标。桌面 Safari 源码仍为 0.99.0，popup CSS 已对齐系统无衬线后备字体。完整开发源码保留较早的字体脚本与默认元数据；此次不迁移已存字体选择，也不声称完整 Safari 同步。选定源码缺少独立原生 host 的图标输入；网站权限、实际重定向、Service Worker 回退和性能需另验。Firefox 发布暂停；Chrome 构建不证明其他浏览器可用。

## 源码与构建

在 macOS 上安装 Deno 2.x 和 Git 后，在本仓库运行下列命令。检查使用合成本地样例；构建在忽略的 Local/candidates 下写入候选并精确读回，不安装扩展或打开浏览器。本地校验可能读取私人默认值；一般及公开构建包不包含该文件。一致的完整候选会核验后复用；其他候选会保留。正常检查使用本地固定依赖，不依赖同级源码目录。

```sh
deno task check
deno task build
```

## 隐私与来源审查

先暂存已审查的具名文件，再执行 deno task public:check 与 deno task public:prepare。public-source.json 选择精确 Git index 输入；导出不含私人操作记录、配置或 Git 历史。候选不可变，重跑只核对，拒绝覆盖不一致内容。模式扫描有限，不能当成完整历史／秘密检测。接收端、数据和浏览器设置不因准备而改变。

## 许可

本版自有代码使用 GNU GPL 第3版（仅限该版，GPL-3.0-only）。以前版本的 MIT 授权继续有效；字体与第三方素材保留原条款。保留 LICENSE、历史 MIT 授权及全部 notices。源码已公开；后续发布仍须审查素材权利和内容。本机候选不代表已安装或完整历史已清理。

## 可选私人默认值

公开源码默认拦截列表为空。直接加载 `extension_chrome/` 时，可创建 Git 忽略的 `extension_chrome/private-defaults.json`，例如 `{"domains":["example.com"]}`，然后重新加载扩展。文件仅作为数据，不执行，也不会进入源码导出或 Chrome、Safari 和 Firefox 构建包。已有设置优先；设置缺失时既有动态规则优先并保留。两者均无时，默认文件缺失或无法读取会使用空列表，JSON 无效则报错。Safari 和 Firefox 不使用这些 Chrome 默认值。

公开构建的默认拦截列表为空。如需本地 Chrome 候选，创建 Git 忽略的 `Local/private-defaults.json`，内容例如 `{"domains":["example.com"]}`，再运行 `deno task private:build`。该命令验证公开源码，并在 `Local/` 下生成独立候选；配置和候选包含私人设置。默认值仅在没有已存设置时使用；已有列表（包括空列表）优先。命令不会安装或重新加载扩展，也不适用于 Safari 或 Firefox。
