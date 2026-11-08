import AppKit
import SafariServices
import SwiftUI

private enum HostConfiguration {
    static var extensionBundleIdentifier: String {
        guard let value = Bundle.main.object(
            forInfoDictionaryKey: "SafariExtensionBundleIdentifier"
        ) as? String, !value.isEmpty else {
            fatalError("SafariExtensionBundleIdentifier is missing")
        }
        return value
    }

    static var displayName: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
            ?? ProcessInfo.processInfo.processName
    }
}

@MainActor
private final class ExtensionState: ObservableObject {
    @Published var enabled: Bool?
    @Published var errorMessage: String?

    func refresh() {
        SFSafariExtensionManager.getStateOfSafariExtension(
            withIdentifier: HostConfiguration.extensionBundleIdentifier
        ) { state, error in
            DispatchQueue.main.async {
                self.enabled = state?.isEnabled
                self.errorMessage = error?.localizedDescription
            }
        }
    }

    func openSettings() {
        SFSafariApplication.showPreferencesForExtension(
            withIdentifier: HostConfiguration.extensionBundleIdentifier
        ) { error in
            DispatchQueue.main.async {
                self.errorMessage = error?.localizedDescription
            }
        }
    }
}

private struct HostView: View {
    @StateObject private var state = ExtensionState()

    var body: some View {
        VStack(spacing: 16) {
            Image(nsImage: NSApplication.shared.applicationIconImage)
                .resizable()
                .frame(width: 72, height: 72)
                .accessibilityHidden(true)
            Text(HostConfiguration.displayName)
                .font(.title2.weight(.semibold))
            Text(statusText)
                .foregroundStyle(state.enabled == true ? .secondary : .primary)
            Button("Open Safari Settings…") {
                state.openSettings()
            }
            .keyboardShortcut(.defaultAction)
            if let error = state.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(28)
        .frame(width: 360, height: 280)
        .onAppear { state.refresh() }
    }

    private var statusText: String {
        switch state.enabled {
        case true: "Enabled in Safari"
        case false: "Enable once in Safari Settings → Extensions"
        case nil: "Checking Safari extension status…"
        }
    }
}

@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    static func main() {
#if ATLAS_BRIDGE
        if CommandLine.arguments.contains("--bridge-self-test") {
            exit(AtlasBridgeSelfTest.run())
        }
        if CommandLine.arguments.contains("--bridge-self-test-cache") {
            exit(
                writeCache(
                    AtlasBridgeSelfTest.result(nonce: argumentValue(after: "--status-nonce")),
                    filename: "SafariBridgeStatus.json"
                )
            )
        }
#endif
        if CommandLine.arguments.contains("--safari-status-cache") {
            printStatusJSON(filename: "SafariExtensionStatus.json")
            return
        }
        if CommandLine.arguments.contains("--safari-status-json") {
            printStatusJSON(filename: nil)
            return
        }
        if CommandLine.arguments.contains("--open-safari-settings") {
            openSafariSettings()
            return
        }
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if CommandLine.arguments.contains("--register-and-quit") {
            SFSafariExtensionManager.getStateOfSafariExtension(
                withIdentifier: HostConfiguration.extensionBundleIdentifier
            ) { _, _ in
                DispatchQueue.main.async { NSApplication.shared.terminate(nil) }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                NSApplication.shared.terminate(nil)
            }
            return
        }

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 280),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = HostConfiguration.displayName
        window.contentViewController = NSHostingController(rootView: HostView())
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        self.window = window
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private static func printStatusJSON(filename: String?) {
        var completed = false
        var payload: [String: Any] = [
            "extensionBundleIdentifier": HostConfiguration.extensionBundleIdentifier,
            "enabled": NSNull(),
        ]
        if let nonce = argumentValue(after: "--status-nonce") {
            payload["nonce"] = nonce
        }
        SFSafariExtensionManager.getStateOfSafariExtension(
            withIdentifier: HostConfiguration.extensionBundleIdentifier
        ) { state, error in
            if let state { payload["enabled"] = state.isEnabled }
            if let error { payload["error"] = error.localizedDescription }
            completed = true
        }
        let deadline = Date().addingTimeInterval(5)
        while !completed && Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        if !completed { payload["error"] = "Safari extension state query timed out" }
        let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        let output = data ?? Data("{}".utf8)
        if let filename {
            exit(writeCache(output, filename: filename))
        }
        FileHandle.standardOutput.write(output)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }

    private static func openSafariSettings() {
        var completed = false
        var failed = false
        SFSafariApplication.showPreferencesForExtension(
            withIdentifier: HostConfiguration.extensionBundleIdentifier
        ) { error in
            failed = error != nil
            completed = true
        }
        let deadline = Date().addingTimeInterval(5)
        while !completed && Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        exit(completed && !failed ? 0 : 1)
    }

    private static func argumentValue(after name: String) -> String? {
        guard
            let index = CommandLine.arguments.firstIndex(of: name),
            CommandLine.arguments.indices.contains(index + 1)
        else { return nil }
        let value = CommandLine.arguments[index + 1]
        guard UUID(uuidString: value) != nil else { return nil }
        return value
    }

    private static func writeCache(_ data: Data, filename: String) -> Int32 {
        do {
            let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: directory.appendingPathComponent(filename), options: .atomic)
            return 0
        } catch {
            return 1
        }
    }
}
