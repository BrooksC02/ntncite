import Foundation

// 跟 CLI 的 JSON 契约对应(pnpm --silent sync --status / --doctor,以及 .sync-history.jsonl)。

struct SyncStatus: Codable {
    struct Health: Codable {
        let zoteroBbt: Bool
        let volume: Bool
    }
    let ts: String
    let pending: Bool
    let papers: Int
    let notes: Int
    let health: Health
    let lastRun: HistoryEntry?
}

struct HistoryEntry: Codable, Identifiable {
    var id: String { ts }
    let ts: String
    let trigger: String
    let create: Int
    let update: Int
    let skip: Int
    let total: Int
    let durationMs: Int
    let ok: Bool
    let error: String?
}

extension HistoryEntry {
    var durationSec: Double { Double(durationMs) / 1000.0 }
    var changes: Int { create + update }
}

struct DoctorReport: Codable {
    let volume: Bool
    let bbt: Bool
    let ntn: Bool
    let ntnWorkspace: String?
    let notion: Bool
}

struct PaperEntry: Codable, Identifiable {
    var id: String { itemKey }
    let itemKey: String
    let title: String
    let citekey: String?
    let year: Int?
    let noteCount: Int
    let authors: String
    let publication: String?
    let standalone: Bool
    let notionPageId: String?
}

/// 运行期配置。路径不硬编码:优先环境变量(launchd 安装脚本会注入正确值),否则给出合理默认。
enum AppConfig {
    /// CLI(sync 引擎)所在目录。launchd plist 注入 `NTNCITE_CLI_DIR`;开发时(Xcode 直接 Run)
    /// 走默认,按需改默认或设 scheme 环境变量。
    static var cliDir: String {
        if let d = ProcessInfo.processInfo.environment["NTNCITE_CLI_DIR"], !d.isEmpty { return d }
        return NSHomeDirectory() + "/Code/ntncite/cli"
    }
    static var pnpm: String {
        ProcessInfo.processInfo.environment["NTNCITE_PNPM"] ?? "/opt/homebrew/bin/pnpm"
    }
    static let launchdLabel = "com.ntncite.sync" // sync(后台同步)那个 agent 的 label
    static let envPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    static var logPath: String { NSHomeDirectory() + "/Library/Logs/ntncite-sync.log" }
    static var historyPath: String { cliDir + "/.sync-history.jsonl" }
    static var plistPath: String { NSHomeDirectory() + "/Library/LaunchAgents/\(launchdLabel).plist" }

    /// 「文献」库的 Notion URL:从 cli/config.json 的 notesDatabaseId / notesDataSourceId 推导;
    /// 拿不到就开 Notion 首页。
    static var notionURL: String {
        let cfg = cliDir + "/config.json"
        if let data = FileManager.default.contents(atPath: cfg),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let notion = obj["notion"] as? [String: Any],
           let id = (notion["notesDatabaseId"] ?? notion["notesDataSourceId"]) as? String {
            return "https://www.notion.so/" + id.replacingOccurrences(of: "-", with: "")
        }
        return "https://www.notion.so"
    }
}
