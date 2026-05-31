import AppKit
import Carbon.HIToolbox
import SwiftUI

@main
struct NtnciteApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var controller = SyncController()

    var body: some Scene {
        MenuBarExtra("文献笔记同步", systemImage: controller.iconName) {
            PopoverView()
                .environmentObject(controller)
        }
        .menuBarExtraStyle(.window)
    }
}

// 菜单栏 only。demo 模式额外挂一个 NSStatusItem + NSPopover,并注册全局热键 ⌃⌥⌘E
// 一键在状态栏位置展开 popover(方便截图,不需要去点小图标)。
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var popover: NSPopover?
    private var hotKeyRef: EventHotKeyRef?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // 菜单栏 only,不占 Dock

        guard ProcessInfo.processInfo.environment["NTNCITE_DEMO"] == "1" else { return }

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(systemSymbolName: "books.vertical", accessibilityDescription: "ntncite demo")
        item.button?.target = self
        item.button?.action = #selector(togglePopover)
        statusItem = item

        let pop = NSPopover()
        pop.behavior = .applicationDefined // 保持展开,截图时不乱关
        pop.contentViewController = NSHostingController(rootView: PopoverView().environmentObject(SyncController()))
        popover = pop

        registerHotKey() // ⌃⌥⌘E
    }

    @objc private func togglePopover() {
        guard let pop = popover, let button = statusItem?.button else { return }
        if pop.isShown {
            pop.performClose(nil)
        } else {
            pop.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func registerHotKey() {
        let hotKeyID = EventHotKeyID(signature: 0x6E746E63 /* 'ntnc' */, id: 1)
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { (_, _, userData) -> OSStatus in
            guard let userData else { return OSStatus(eventNotHandledErr) }
            let me = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
            DispatchQueue.main.async { me.togglePopover() }
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), nil)
        let mods = UInt32(controlKey | optionKey | cmdKey)
        RegisterEventHotKey(UInt32(kVK_ANSI_E), mods, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef)
    }
}
