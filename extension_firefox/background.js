// Background clipboard works for both HTTP and HTTPS source pages. Never read
// the clipboard, fetch a destination, or receive messages from website scripts.
browser.runtime.onMessage.addListener((message, sender) => {
  if (
    sender.id !== browser.runtime.id ||
    message?.type !== "prometheus.firefox.clipboard.v1" ||
    typeof message.text !== "string" ||
    new TextEncoder().encode(message.text).length > 512 * 1024
  ) return undefined;
  return navigator.clipboard.writeText(message.text).then(
    () => ({ ok: true }),
    () => ({ ok: false }),
  );
});
