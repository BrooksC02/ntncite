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

private func extractJSON(_ s: String) -> Data? {
    guard let start = s.firstIndex(of: "{"), let end = s.lastIndex(of: "}") else { return nil }
    return String(s[start...end]).data(using: .utf8)
}
private func extractJSONArray(_ s: String) -> Data? {
    guard let start = s.firstIndex(of: "["), let end = s.lastIndex(of: "]") else { return nil }
    return String(s[start...end]).data(using: .utf8)
}

private let langKey = "ntncite.lang"

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
    @Published var lang: Lang

    /// 截图/试用用的演示模式:NTNCITE_DEMO=1 时用公开论文填充,不碰真实 Zotero/Notion。
    private let isDemo = ProcessInfo.processInfo.environment["NTNCITE_DEMO"] == "1"

    init() {
        if let saved = UserDefaults.standard.string(forKey: langKey), let l = Lang(rawValue: saved) {
            lang = l
        } else {
            lang = (Locale.current.language.languageCode?.identifier == "zh") ? .zh : .en
        }
        Task { await self.tick() }
        if !isDemo { Task { await self.pollLoop() } }
    }

    func loc(_ en: String, _ zh: String) -> String { lang == .zh ? zh : en }

    func setLang(_ l: Lang) {
        lang = l
        UserDefaults.standard.set(l.rawValue, forKey: langKey)
    }

    private func pollLoop() async {
        while true {
            try? await Task.sleep(nanoseconds: 45 * 1_000_000_000)
            await tick()
        }
    }

    func tick() async {
        if isDemo { loadDemo(); return }
        await refreshStatus()
        await loadEntries()
        await refreshDoctor()
        loadHistory()
        await refreshLaunchd()
    }

    /// 演示数据(著名公开论文,零真实信息)。
    func loadDemo() {
        let now = Date()
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func iso(_ ago: TimeInterval) -> String { f.string(from: now.addingTimeInterval(-ago)) }

        doctor = DoctorReport(volume: true, bbt: true, ntn: true, ntnWorkspace: "Demo", notion: true)
        let demo: [(String, String, Int, String, Int)] = [
            ("Attention Is All You Need", "vaswani2017", 2017, "Vaswani A, Shazeer N, Parmar N et al.", 3),
            ("Deep Residual Learning for Image Recognition", "he2016", 2016, "He K, Zhang X, Ren S, Sun J", 1),
            ("Language Models are Few-Shot Learners", "brown2020", 2020, "Brown T, Mann B et al.", 2),
            ("Adam: A Method for Stochastic Optimization", "kingma2015", 2015, "Kingma D, Ba J", 1),
            ("Generative Adversarial Networks", "goodfellow2014", 2014, "Goodfellow I et al.", 2),
            ("BERT: Pre-training of Deep Bidirectional Transformers", "devlin2019", 2019, "Devlin J et al.", 1),
            ("ImageNet Classification with Deep CNNs", "krizhevsky2012", 2012, "Krizhevsky A, Sutskever I, Hinton G", 1),
            ("Highly accurate protein structure prediction with AlphaFold", "jumper2021", 2021, "Jumper J et al.", 4),
        ]
        entries = demo.map { t, ck, y, au, n in
            PaperEntry(itemKey: ck, title: t, citekey: ck, year: y, noteCount: n,
                       authors: au, publication: nil, standalone: false, notionPageId: nil)
        }
        history = [
            HistoryEntry(ts: iso(180), trigger: "manual", create: 0, update: 0, skip: 8, total: 8, durationMs: 1240, ok: true, error: nil),
            HistoryEntry(ts: iso(3600), trigger: "auto", create: 1, update: 0, skip: 7, total: 8, durationMs: 1510, ok: true, error: nil),
            HistoryEntry(ts: iso(7200), trigger: "force", create: 0, update: 8, skip: 0, total: 8, durationMs: 12830, ok: true, error: nil),
            HistoryEntry(ts: iso(90000), trigger: "auto", create: 2, update: 0, skip: 5, total: 7, durationMs: 1100, ok: true, error: nil),
        ]
        status = SyncStatus(ts: iso(0), pending: false, papers: 8, notes: 15,
                            health: .init(zoteroBbt: true, volume: true), lastRun: history.first)
        launchdLoaded = true
        intervalMinutes = 15
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
        guard !isSyncing, !isDemo else { return }
        isSyncing = true
        lastError = nil
        let r = await pnpm(force ? ["--force"] : [])
        if r.code != 0 {
            lastError = r.stderr.split(separator: "\n").last.map(String.init) ?? loc("sync failed", "同步失败")
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
        guard !isDemo, var dict = try? readPlist() else { return }
        dict["StartInterval"] = minutes * 60
        if let data = try? PropertyListSerialization.data(fromPropertyList: dict, format: .xml, options: 0) {
            try? data.write(to: URL(fileURLWithPath: AppConfig.plistPath))
            _ = await runExec("/bin/launchctl", ["unload", AppConfig.plistPath])
            _ = await runExec("/bin/launchctl", ["load", "-w", AppConfig.plistPath])
        }
        await refreshLaunchd()
    }

    func toggleLaunchd() async {
        if isDemo { return }
        if launchdLoaded {
            _ = await runExec("/bin/launchctl", ["unload", AppConfig.plistPath])
        } else {
            _ = await runExec("/bin/launchctl", ["load", "-w", AppConfig.plistPath])
        }
        await refreshLaunchd()
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

    // MARK: 派生展示(本地化)

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
        case .syncing: return loc("Syncing…", "同步中…")
        case .error: return loc("Component offline", "有组件离线")
        case .pending: return loc("Changes pending", "有改动待同步")
        case .idle: return loc("Up to date", "已是最新")
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
        guard let last = status?.lastRun else { return loc("No sync yet", "尚无同步记录") }
        let changed = last.create + last.update
        let dur = String(format: "%.1fs", Double(last.durationMs) / 1000.0)
        let mark = last.ok ? "✓" : "✗"
        return loc(
            "Last: \(rel(last.ts)) · \(last.total) papers (\(changed) changed) · \(dur) \(mark)",
            "上次:\(rel(last.ts)) · \(last.total) 篇(改 \(changed))· \(dur) \(mark)"
        )
    }

    func rel(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return iso }
        let s = Int(Date().timeIntervalSince(date))
        if s < 60 { return loc("just now", "刚刚") }
        if s < 3600 { return loc("\(s / 60)m ago", "\(s / 60) 分钟前") }
        if s < 86400 { return loc("\(s / 3600)h ago", "\(s / 3600) 小时前") }
        return loc("\(s / 86400)d ago", "\(s / 86400) 天前")
    }
}
