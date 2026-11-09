# no

no 是 Chrome 域名拦截扩展，当前版本 0.99.1，以全窗口 NO ✋ 阻止访问选定域名。
在弹出窗口中添加域名或 HTTP(S) URL、启用条目并保存。界面区分规则已应用与仅在
本地保存但规则待应用的状态；再次保存可重试。请在 Chrome 扩展设置中允许网站访问。
包含英文、简体中文和繁体中文；保留既有扩展身份、密钥及设置。

拦截页面默认使用系统字体；可在扩展选项中选择 GlyphgrovePixel 或 GlyphgroveDeparture。字型私用，重分发权利仍在审查。

Chrome「加载已解压的扩展程序」直接选择 `extension_chrome/`，无需工作区或软链接。
在 macOS 上安装 Deno 2.x 与 Git，运行
`deno task check`、`deno task build`。检查使用合成数据； 构建只生成并读回验证
`Local/candidates/` 中的候选，不安装或打开浏览器。 共享输入由
`dependencies.lock.json` 固定；日常构建不读取相邻项目。
更新依赖须先修改源项目，再显式同步。工具和依赖见
[DEPENDENCIES](DEPENDENCIES.md)。 桌面 macOS Safari 来源版本也为
0.99.0；其构建、签名与安装另行验证；Firefox 发布仍暂停。

暂存具名变更后，运行 `deno task maintenance`、`deno task public:prepare`。
`public-source.json` 明列 Git 暂存区来源；私有操作记录和 Git 历史不在候选中。
候选保存在已忽略的
`Local/public-source/`，收据仅含相对路径；重复执行核对完整文件、
字节及模式，差异会失败且不覆盖。`public:check` 可重复只读检查。
符号链接和有限敏感模式检查不能代替完整内容与历史审查。

本版自有代码采用 [GNU GPL 第 3 版（仅限该版）](LICENSE)（`GPL-3.0-only`），
版权归 2026 X-ExtNo contributors。[许可范围](LICENSE-SCOPE.md) 保留先前 MIT
授权的历史事实。字体和第三方资产沿用其既有许可、声明和作者。已移除的字体实验
字体文件不随包 分发，也不在来源候选内；提及该字体的固定元数据不代表分发授权。
源码已公开；后续发布仍须审查内容、资产权利与历史。
这些命令不会上传、发布、安装或重写历史。完整入口见 [README](README.md)。

导出的独立来源候选不含 Firefox 私有操作文档；当前依赖锁不要求这些文档。
复制候选后可运行 `deno task check` 与 `deno task public:build`。
独立路径验证全部选定依赖、字体、资源及 Chrome 身份；缺失或变更的运行时输入会失败。输出与相对路径回执保存在 `Local/public-build/`，重跑读回
完整文件与字节；不会覆盖不匹配候选，也不会构建或启用 Firefox。

桌面 Safari 保留独立的 0.99.0 源码；Chrome 私人默认值处理尚未同步或验证。
先前审查的经典 worker 语法检查通过。popup CSS 已对齐 Chrome 的系统无衬线后备字体。完整开发源码仍保留
较早的字体脚本与默认元数据；此次不迁移已存字体选择，也不声称完整 Safari 同步。
独立原生 host 生成还缺选定源码以外的图标输入。清单已声明 DNR 重定向及主机权限；
实际网站授权、重定向、站点 Service Worker 回退和性能仍需独立 Safari 验收。

## 可选私人默认值

公开源码默认拦截列表为空。直接加载 `extension_chrome/` 时，可创建 Git 忽略的 `extension_chrome/private-defaults.json`，例如 `{"domains":["example.com"]}`，然后重新加载扩展。文件仅作为数据，不执行，也不会进入源码导出或 Chrome、Safari 和 Firefox 构建包。已有设置优先；设置缺失时既有动态规则优先并保留。两者均无时，默认文件缺失或无法读取会使用空列表，JSON 无效则报错。Safari 和 Firefox 不使用这些 Chrome 默认值。

公开构建的默认拦截列表为空。如需本地 Chrome 候选，创建 Git 忽略的 `Local/private-defaults.json`，内容例如 `{"domains":["example.com"]}`，再运行 `deno task private:build`。该命令验证公开源码，并在 `Local/` 下生成独立候选；配置和候选包含私人设置。默认值仅在没有已存设置时使用；已有列表（包括空列表）优先。命令不会安装或重新加载扩展，也不适用于 Safari 或 Firefox。
