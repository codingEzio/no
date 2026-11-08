/** Recognized historical source labels only. Unknown text is never stripped. */
const labels: Record<string, string> = {
  "x.com": "X__",
  "twitter.com": "X__",
  "bilibili.com": "BILI__",
  "b23.tv": "BILI__",
  "youtube.com": "YTB__",
  "youtu.be": "YTB__",
  "github.com": "GH__",
  "github.blog": "GH__",
  "instagram.com": "IG__",
  "reddit.com": "RDT__",
  "pinterest.com": "PIN__",
  "pin.it": "PIN__",
  "v2ex.com": "V2EX__",
  "ithome.com": "ITH__",
  "chatgpt.com": "OAI__",
  "missav.ai": "MISSAV__",
  "pornpics.com": "PORNPICS__",
  "jav.guru": "JAVGURU__",
  "pornhub.com": "PH__",
};
export function splitBookmarkTitlePrefix(title: string, url: string) {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const prefix = Object.entries(labels).find(([domain]) =>
    host === domain || host.endsWith("." + domain)
  )?.[1];
  return prefix && title.startsWith(prefix) && title.length > prefix.length
    ? { title: title.slice(prefix.length), title_prefix: prefix }
    : null;
}
