import AppKit
import SwiftUI

@main
struct ZoteroNotionBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var controller = SyncController()

    var body: some Scene {
        MenuBarExtra("文献同步", systemImage: controller.iconName) {
            PopoverView()
                .environmentObject(controller)
        }
        .menuBarExtraStyle(.window) // 弹窗样式:可放动画 / 图表 / 表格的自定义 UI
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // 菜单栏 only,不在 Dock 显示图标
        NSApp.setActivationPolicy(.accessory)
    }
}
