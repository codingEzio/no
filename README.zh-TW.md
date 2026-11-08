# no

<p><img src="extension_chrome/icons/icon-128.png" width="96" height="96" alt="no"></p>

封鎖頁面預設使用系統字型；可在擴充功能選項中選擇 GlyphgrovePixel 或 GlyphgroveDeparture。字型限私用，重新散布權利仍在審查。

no 是 Chrome 網域封鎖擴充，目前版本 0.99.1，以全視窗 NO ✋ 阻止存取選定網域。
在彈出視窗加入網域或 HTTP(S) URL、啟用項目並儲存。介面區分規則已套用與僅在
本機儲存但規則待套用的狀態；再次儲存可重試。請在 Chrome 擴充設定允許網站存取。
包含英文、簡體中文與繁體中文；保留既有擴充身分、金鑰及設定。

Chrome「載入未封裝項目」直接選擇 `extension_chrome/`，無需工作區或符號連結。
在 macOS 上安裝 Deno 2.x 與 Git，執行
`deno task check`、`deno task build`。檢查使用合成資料； 建置只產生並讀回驗證
`Local/candidates/` 中的候選，不安裝或開啟瀏覽器。 共用輸入由
`dependencies.lock.json` 固定；日常建置不讀取相鄰專案。
更新相依須先修改來源專案，再明確同步。工具與相依見
[DEPENDENCIES](DEPENDENCIES.md)。 桌面 macOS Safari 來源版本也為
0.99.0；其建置、簽署與安裝另行驗證；Firefox 發布仍暫停。

暫存具名變更後，執行 `deno task maintenance`、`deno task public:prepare`。
`public-source.json` 明列 Git 暫存區來源；私有操作紀錄與 Git 歷史不在候選中。
候選儲存於已忽略的 `Local/public-source/`，收據僅含相對路徑；重跑核對完整檔案、
位元組與模式，差異會失敗且不覆寫。`public:check` 可重複唯讀檢查。
符號連結與有限敏感模式檢查不能取代完整內容與歷史審查。

本版自有程式碼採用 [GNU GPL 第 3 版（僅限該版）](LICENSE)（`GPL-3.0-only`），
著作權歸 2026 X-ExtNo contributors。[授權範圍](LICENSE-SCOPE.md) 保留先前 MIT
授權的歷史事實。字型與第三方資產沿用其既有授權、聲明與作者。已移除的字型實驗
字型檔不隨套件 散布，也不在來源候選內；提及該字型的固定 metadata
不代表散布授權。 原始碼已公開；後續發布仍須審查內容、資產權利與歷史。
這些命令不會上傳、發布、安裝或改寫歷史。完整入口見 [README](README.md)。

匯出的獨立來源候選排除兩個固定的 Firefox 私有操作文件。原 `check`／`build`
仍嚴格 要求完整本機檢出；複製候選後執行 `deno task test` 與
`deno task public:build`。
獨立路徑只豁免這兩個文件，仍驗證全部選定相依、字型、資源與 Chrome 身分；缺少或
變更的 runtime 輸入會失敗。輸出與相對路徑收據儲存於
`Local/public-build/`，重跑讀回
完整檔案與位元組；不會覆寫不符候選，也不會建置或啟用 Firefox。

桌面 Safari 審查：核心、控制器、背景及導覽來源與 Chrome 相同，傳統 worker
語法檢查通過。popup CSS 已對齊 Chrome 的系統無襯線後備字型。完整開發來源仍保留
較早的字型腳本與預設中繼資料；此次不遷移已存字型選擇，也不聲稱完整 Safari 同步。
獨立原生 host 生成還缺選定來源以外的圖示輸入。清單已宣告 DNR
重新導向及主機權限； 實際網站授權、重新導向、網站 Service Worker
後備處理與效能仍需獨立 Safari 驗收。

## 可選私人預設值

公開原始碼的預設封鎖清單為空。直接載入 `extension_chrome/` 時，可建立 Git 忽略的 `extension_chrome/private-defaults.json`，例如 `{"domains":["example.com"]}`，再重新載入擴充功能。檔案僅作資料，不執行，也不會納入原始碼匯出或建置套件。既有設定優先；設定缺失時既有動態規則優先並保留。兩者皆無時，預設檔缺失或無法讀取會使用空清單，JSON 無效則報錯。Safari 與 Firefox 不使用這些 Chrome 預設值。

公開建置的預設封鎖清單為空。如需本機 Chrome 候選，建立 Git 忽略的 `Local/private-defaults.json`，內容例如 `{"domains":["example.com"]}`，再執行 `deno task private:build`。此命令驗證公開原始碼，並在 `Local/` 下產生獨立候選；設定檔與候選包含私人設定。預設值只在沒有已儲存設定時使用；既有清單（包括空清單）優先。命令不會安裝或重新載入擴充功能，也不適用於 Safari 或 Firefox。
