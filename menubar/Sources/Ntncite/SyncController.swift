import AppKit
import Foundation
import SwiftUI

struct ExecResult {
    let stdout: String
    let stderr: String
    let code: Int32
}

/// 在后台跑外部命令,捕获输出。不阻塞主线程。
func runExec(_ launchPath: String, _ args: [String], cwd: String? = nil) async -> ExecResult {
    await withCheckedContinuation { (cont: CheckedContinuation<ExecResult, Never>) in
        DispatchQueue.global(qos: .userInitiated).async {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: launchPath)
            p.arguments = args
            if let cwd { p.currentDirectoryURL = URL(fileURLWithPath: cwd) }
            var env = ProcessInfo.processInfo.environment
            env["PATH"] = AppConfig.envPath
            p.environment = env
            let out = Pipe()
            let err = Pipe()
            p.standardOutput = out
            p.standardError = err
            do {
                try p.run()
            } catch {
                cont.resume(returning: ExecResult(stdout: "", stderr: "\(error)", code: -1))
                return
            }
            let od = out.fileHandleForReading.readDataToEndOfFile()
            let ed = err.fileHandleForReading.readDataToEndOfFile()
            p.waitUntilExit()
            cont.resume(returning: ExecResult(
                stdout: String(data: od, encoding: .utf8) ?? "",
                stderr: String(data: ed, encoding: .utf8) ?? "",
                code: p.terminationStatus
            ))
        }
    }
}

/// 从可能混入杂质的输出里抠出 JSON 对象(防御性,正常 pnpm --silent 已是纯 JSON)。
private func extractJSON(_ s: String) -> Data? {
    guard let start = s.firstIndex(of: "{"), let end = s.lastIndex(of: "}") else { return nil }
    return String(s[start...end]).data(using: .utf8)
}

/// 抠出 JSON 数组(--list 输出)。
private func extractJSONArray(_ s: String) -> Data? {
    guard let start = s.firstIndex(of: "["), let end = s.lastIndex(of: "]") else { return nil }
    return String(s[start...end]).data(using: .utf8)
}

@MainActor
final class SyncController: ObservableObject {
    @Published var status: SyncStatus?
    @Published var doctor: DoctorReport?
    @Published var entries: [PaperEntry] = []
    @Published var history: [HistoryEntry] = []
    @Published var isSyncing = false
    @Published var launchdLoaded = true
    @Published var intervalMinutes = 15
    @Published var lastError: String?

    init() {
        Task { await self.tick() }
        Task { await self.pollLoop() }
    }

    private func pollLoop() async {
        while true {
            try? await Task.sleep(nanoseconds: 45 * 1_000_000_000)
            await tick()
        }
    }

    /// 周期刷新:状态 + 条目 + 健康 + 历史 + launchd 状态。
    func tick() async {
        await refreshStatus()
        await loadEntries()
        await refreshDoctor()
        loadHistory()
        await refreshLaunchd()
    }

    private func pnpm(_ args: [String]) async -> ExecResult {
        await runExec(AppConfig.pnpm, ["--silent", "sync"] + args, cwd: AppConfig.cliDir)
    }

    func refreshStatus() async {
        let r = await pnpm(["--status"])
        if let data = extractJSON(r.stdout),
           let s = try? JSONDecoder().decode(SyncStatus.self, from: data) {
            self.status = s
        }
    }

    func refreshDoctor() async {
        let r = await pnpm(["--doctor"])
        if let data = extractJSON(r.stdout),
           let d = try? JSONDecoder().decode(DoctorReport.self, from: data) {
            self.doctor = d
        }
    }

    func loadEntries() async {
        let r = await pnpm(["--list"])
        if let data = extractJSONArray(r.stdout),
           let arr = try? JSONDecoder().decode([PaperEntry].self, from: data) {
            self.entries = arr
        }
    }

    /// 点条目 → 跳它的 Notion 页(没有 pageId 就开整个库)。
    func openPaper(_ e: PaperEntry) {
        if let pid = e.notionPageId, !pid.isEmpty {
            let clean = pid.replacingOccurrences(of: "-", with: "")
            if let u = URL(string: "https://www.notion.so/\(clean)") {
                NSWorkspace.shared.open(u)
                return
            }
        }
        open(.notion)
    }

    func loadHistory() {
        guard let text = try? String(contentsOfFile: AppConfig.historyPath, encoding: .utf8) else {
            history = []
            return
        }
        let dec = JSONDecoder()
        let entries = text.split(separator: "\n").compactMap { line -> HistoryEntry? in
            guard let d = line.data(using: .utf8) else { return nil }
            return try? dec.decode(HistoryEntry.self, from: d)
        }
        history = Array(entries.suffix(20).reversed())
    }

    func syncNow(force: Bool) async {
        guard !isSyncing else { return }
        isSyncing = true
        lastError = nil
        let r = await pnpm(force ? ["--force"] : [])
        if r.code != 0 {
            lastError = r.stderr.split(separator: "\n").last.map(String.init) ?? "同步失败"
        }
        isSyncing = false
        await tick()
    }

    // MARK: launchd

    func refreshLaunchd() async {
        let r = await runExec("/bin/launchctl", ["list", AppConfig.launchdLabel])
        launchdLoaded = (r.code == 0)
        if let dict = try? readPlist(), let n = dict["StartInterval"] as? Int {
            intervalMinutes = max(1, n / 60)
        }
    }

    private func readPlist() throws -> [String: Any]? {
        let data = try Data(contentsOf: URL(fileURLWithPath: AppConfig.plistPath))
        return try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
    }

    func setInterval(minutes: Int) async {
        guard var dict = try? readPlist() else { return }
        dict["StartInterval"] = minutes * 60
        if let data = try? PropertyListSerialization.data(fromPropertyList: dict, format: .xml, options: 0) {
            try? data.write(to: URL(fileURLWithPath: AppConfig.plistPath))
            _ = await runExec("/bin/launchctl", ["unload", AppConfig.plistPath])
            _ = await runExec("/bin/launchctl", ["load", "-w", AppConfig.plistPath])
        }
        await refreshLaunchd()
    }

    func toggleLaunchd() async {
        if launchdLoaded {
            _ = await runExec("/bin/launchctl", ["unload", AppConfig.plistPath])
        } else {
            _ = await runExec("/bin/launchctl", ["load", "-w", AppConfig.plistPath])
        }
        await refreshLaunchd()
    }

    func kickstart() async {
        let uid = getuid()
        _ = await runExec("/bin/launchctl", ["kickstart", "-k", "gui/\(uid)/\(AppConfig.launchdLabel)"])
        await tick()
    }

    // MARK: open links

    enum OpenTarget { case notion, log, zotero, project }

    func open(_ t: OpenTarget) {
        let ws = NSWorkspace.shared
        switch t {
        case .notion:
            if let u = URL(string: AppConfig.notionURL) { ws.open(u) }
        case .log:
            ws.open(URL(fileURLWithPath: AppConfig.logPath))
        case .zotero:
            if let u = URL(string: "zotero://") { ws.open(u) }
        case .project:
            ws.open(URL(fileURLWithPath: AppConfig.cliDir))
        }
    }

    // MARK: 派生展示

    var iconName: String {
        if isSyncing { return "arrow.triangle.2.circlepath" }
        if let d = doctor, !(d.bbt && d.ntn && d.volume && d.notion) { return "exclamationmark.triangle.fill" }
        if status?.pending == true { return "books.vertical.circle.fill" }
        return "books.vertical"
    }

    enum UIState { case syncing, error, pending, idle }
    var uiState: UIState {
        if isSyncing { return .syncing }
        if let d = doctor, !(d.bbt && d.ntn && d.volume && d.notion) { return .error }
        if status?.pending == true { return .pending }
        return .idle
    }
    var stateText: String {
        switch uiState {
        case .syncing: return "同步中…"
        case .error: return "有组件离线"
        case .pending: return "有改动待同步"
        case .idle: return "已是最新"
        }
    }
    var stateColor: Color {
        switch uiState {
        case .syncing: return .blue
        case .error: return .red
        case .pending: return .orange
        case .idle: return .green
        }
    }

    var statusSummary: String {
        guard let last = status?.lastRun else { return "尚无同步记录" }
        let when = relativeTime(last.ts)
        let changed = last.create + last.update
        let dur = String(format: "%.1fs", Double(last.durationMs) / 1000.0)
        let mark = last.ok ? "✓" : "✗"
        return "上次:\(when) · \(last.total) 篇(改 \(changed))· \(dur) \(mark)"
    }

    var healthSummary: String {
        guard let d = doctor else { return "健康:检测中…" }
        func dot(_ ok: Bool) -> String { ok ? "🟢" : "🔴" }
        return "BBT\(dot(d.bbt)) ntn\(dot(d.ntn)) 卷\(dot(d.volume)) Notion\(dot(d.notion))"
    }

    var intervalLabel: String { "\(intervalMinutes) 分钟" }

    func historyLine(_ h: HistoryEntry) -> String {
        let when = relativeTime(h.ts)
        let dur = String(format: "%.1fs", Double(h.durationMs) / 1000.0)
        let mark = h.ok ? "✓" : "✗"
        return "\(when) · +\(h.create)/~\(h.update)/=\(h.skip) · \(dur) \(mark)"
    }
}

/// ISO8601 → "x 分钟前" 这类相对时间。
func relativeTime(_ iso: String) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    guard let date else { return iso }
    let secs = Int(Date().timeIntervalSince(date))
    if secs < 60 { return "刚刚" }
    if secs < 3600 { return "\(secs / 60) 分钟前" }
    if secs < 86400 { return "\(secs / 3600) 小时前" }
    return "\(secs / 86400) 天前"
}
