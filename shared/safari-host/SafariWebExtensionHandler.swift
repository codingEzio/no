import SafariServices

// Most module extensions are web-only. Native messages are rejected rather
// than silently accepted so an accidental new bridge cannot look successful.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let response = NSExtensionItem()
        response.userInfo = [
            SFExtensionMessageKey: [
                "status": "failed",
                "code": "native_messaging_not_configured",
            ],
        ]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
