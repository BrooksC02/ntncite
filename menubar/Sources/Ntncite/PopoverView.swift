import AppKit
import SwiftUI

private extension View {
    func sectionCard() -> some View {
        padding(9).background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
    }
}

struct PopoverView: View {
    @EnvironmentObject var c: SyncController
    @State private var tab = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if c.doctor?.bbt == false { bbtWarning }
            syncButtons
            healthCard
            automationCard
            tabbedCard
            footer
        }
        .padding(14)
        .frame(width: 380)
        .background(.thickMaterial)
    }

    // MARK: 头部

    private var header: some View {
        HStack(spacing: 11) {
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(c.stateColor.opacity(0.18))
                .frame(width: 44, height: 44)
                .overlay {
                    if c.isSyncing {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: c.iconName)
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(c.stateColor)
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(c.loc("ntncite", "文献同步")).font(.headline)
                Text(c.stateText).font(.subheadline).foregroundStyle(c.stateColor)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                if let pd = c.pendingDetail {
                    Text("● \(pd)")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.orange)
                }
                Text(c.loc("\(c.entries.count) papers · \(c.status?.notes ?? 0) notes",
                           "\(c.entries.count) 篇 · \(c.status?.notes ?? 0) 笔记"))
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: BBT 掉线警告(硬依赖)

    private var bbtWarning: some View {
        HStack(spacing: 7) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text(c.loc("BBT offline (Zotero not running?) — sync paused; citekeys/metadata unavailable",
                       "BBT 未连(Zotero 没开?)—— 同步已暂停,citekey / 题录读不到"))
                .font(.caption)
            Spacer(minLength: 0)
        }
        .padding(9)
        .background(Color.orange.opacity(0.14), in: RoundedRectangle(cornerRadius: 9))
    }

    // MARK: 同步操作

    private var syncButtons: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(c.statusSummary).font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Button { Task { await c.syncNow(force: false) } } label: {
                    HStack(spacing: 5) {
                        if c.isSyncing {
                            ProgressView().controlSize(.mini)
                        } else {
                            Image(systemName: "bolt.fill")
                        }
                        Text(c.isSyncing ? c.loc("Syncing…", "同步中…") : c.loc("Sync now", "立即同步"))
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(c.isSyncing)

                Button { Task { await c.syncNow(force: true) } } label: {
                    Image(systemName: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(c.isSyncing)
                .help(c.loc("Force full re-push (refresh all metadata)", "强制全量重推(刷新所有元数据)"))
            }
            if let err = c.lastError {
                Text("✗ \(err)").font(.caption2).foregroundStyle(.red).lineLimit(2)
            }
        }
    }

    // MARK: 健康胶囊(BBT = Better BibTeX 探活)

    private var healthCard: some View {
        HStack(spacing: 6) {
            healthPill("BBT", c.doctor?.bbt).help(c.loc("Zotero running + Better BibTeX on :23119", "Zotero 开着 + Better BibTeX :23119 活"))
            healthPill("ntn", c.doctor?.ntn).help(c.loc("Notion CLI logged in", "Notion CLI 已登录"))
            healthPill(c.loc("vol", "卷"), c.doctor?.volume).help(c.loc("zotero.sqlite reachable", "能读到 zotero.sqlite"))
            healthPill("Notion", c.doctor?.notion).help(c.loc("Library DB reachable", "「Library」库可达"))
            Spacer(minLength: 0)
        }
        .sectionCard()
    }

    private func healthPill(_ label: String, _ ok: Bool?) -> some View {
        let color: Color = ok == nil ? .gray : (ok! ? .green : .red)
        return HStack(spacing: 4) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label).font(.caption2.weight(.medium))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Capsule().fill(color.opacity(0.12)))
    }

    // MARK: 自动同步控制

    private var automationCard: some View {
        HStack(spacing: 8) {
            Image(systemName: "clock").font(.caption).foregroundStyle(.secondary)
            Picker("", selection: Binding(
                get: { c.intervalMinutes },
                set: { m in Task { await c.setInterval(minutes: m) } }
            )) {
                ForEach([5, 15, 30, 60], id: \.self) { Text("\($0)m").tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Button { Task { await c.toggleLaunchd() } } label: {
                Image(systemName: c.launchdLoaded ? "pause.circle.fill" : "play.circle.fill")
                    .font(.title3)
                    .foregroundStyle(c.launchdLoaded ? Color.secondary : Color.green)
            }
            .buttonStyle(.borderless)
            .help(c.launchdLoaded ? c.loc("Pause auto-sync", "暂停自动同步") : c.loc("Resume auto-sync", "恢复自动同步"))
        }
        .sectionCard()
    }

    // MARK: 分段:条目 / 历史

    private var tabbedCard: some View {
        VStack(spacing: 8) {
            Picker("", selection: $tab) {
                Text(c.loc("Entries \(c.entries.count)", "条目 \(c.entries.count)")).tag(0)
                Text(c.loc("History", "历史")).tag(1)
                Text(c.loc("Stale", "残留")).tag(2)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            switch tab {
            case 0: entriesList
            case 1: historyList
            default: orphansList
            }
        }
        .sectionCard()
    }

    // MARK: 残留页(Zotero 已无对应,Notion 还留着 —— 按需查)

    private var orphansList: some View {
        ScrollView {
            VStack(spacing: 1) {
                if c.orphansLoading {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.mini)
                        Text(c.loc("Checking Notion…", "正在查 Notion…")).font(.caption2).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else if c.orphans.isEmpty {
                    Text(c.orphansChecked ? c.loc("No stale pages 🎉", "没有残留页 🎉")
                                          : c.loc("Checking…", "检查中…"))
                        .font(.caption2).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(c.loc("In Notion but no longer in Zotero — click to open & delete by hand:",
                               "Notion 有、Zotero 已无 —— 点开手动删:"))
                        .font(.caption2).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.bottom, 2)
                    ForEach(c.orphans) { o in
                        Button { c.openOrphan(o) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "doc.badge.ellipsis").font(.caption).foregroundStyle(.orange)
                                Text(o.title).font(.caption.weight(.medium)).lineLimit(1)
                                Spacer(minLength: 6)
                                Image(systemName: "arrow.up.right").font(.caption2).foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4).padding(.horizontal, 5).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.trailing, 6)
        }
        .frame(height: 170)
        .onAppear { if !c.orphansLoading { Task { await c.checkOrphans() } } }
    }

    // MARK: 条目列表(点击跳 Notion 页)

    private var entriesList: some View {
        ScrollView {
            VStack(spacing: 1) {
                if c.entries.isEmpty {
                    Text(c.loc("(no entries)", "(无条目)"))
                        .font(.caption2).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ForEach(c.entries) { e in
                        Button { c.openPaper(e) } label: {
                            HStack(spacing: 8) {
                                Circle().fill(entryStateColor(e.syncState)).frame(width: 7, height: 7)
                                    .help(entryStateHelp(e.syncState))
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(e.title).font(.caption.weight(.medium)).lineLimit(1)
                                    Text(entrySubtitle(e))
                                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer(minLength: 6)
                                if let ic = e.imageCount, ic > 0 {
                                    Image(systemName: "photo")
                                        .font(.caption2).foregroundStyle(.secondary)
                                        .help(c.loc("\(ic) inline image(s) not synced", "\(ic) 张内嵌图未同步"))
                                }
                                Text("\(e.noteCount)")
                                    .font(.caption2.weight(.semibold))
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Capsule().fill(Color.accentColor.opacity(0.15)))
                                    .foregroundStyle(Color.accentColor)
                            }
                            .padding(.vertical, 4)
                            .padding(.horizontal, 5)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.trailing, 6)
        }
        .frame(height: 170)
    }

    private func entrySubtitle(_ e: PaperEntry) -> String {
        var parts: [String] = []
        if let ck = e.citekey { parts.append(ck) } else if e.standalone { parts.append(c.loc("standalone note", "独立笔记")) }
        if let y = e.year { parts.append(String(y)) }
        if !e.authors.isEmpty { parts.append(e.authors) }
        return parts.joined(separator: " · ")
    }

    private func entryStateColor(_ s: String?) -> Color {
        switch s {
        case "new": return .blue
        case "changed": return .orange
        default: return Color.secondary.opacity(0.35)
        }
    }
    private func entryStateHelp(_ s: String?) -> String {
        switch s {
        case "new": return c.loc("new — not synced yet", "新 —— 尚未同步")
        case "changed": return c.loc("changed — pending update", "已改 —— 待更新")
        default: return c.loc("synced", "已同步")
        }
    }

    // MARK: 历史

    private var historyList: some View {
        ScrollView {
            VStack(spacing: 2) {
                if c.history.isEmpty {
                    Text(c.loc("(no history)", "(暂无记录)")).font(.caption2).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ForEach(c.history) { h in
                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 6) {
                                Text(c.rel(h.ts)).frame(width: 64, alignment: .leading)
                                Text(triggerMark(h.trigger))
                                Text("+\(h.create) ~\(h.update) =\(h.skip)").foregroundStyle(.secondary)
                                Spacer(minLength: 6)
                                Text(String(format: "%.1fs", h.durationSec))
                                Image(systemName: h.ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                                    .foregroundStyle(h.ok ? .green : .red)
                            }
                            if let fs = h.failures, !fs.isEmpty {
                                Text("✗ " + fs.map(\.title).joined(separator: ", "))
                                    .foregroundStyle(.red).lineLimit(2)
                            }
                        }
                        .font(.caption2)
                        .padding(.vertical, 1)
                    }
                }
            }
            .padding(.trailing, 6)
        }
        .frame(height: 170)
    }

    private func triggerMark(_ t: String) -> String {
        switch t {
        case "auto": return "🕒"
        case "force": return "⟳"
        default: return "✋"
        }
    }

    // MARK: 底部

    private var footer: some View {
        HStack(spacing: 16) {
            Button { c.open(.notion) } label: { Image(systemName: "book") }.help(c.loc("Open Library DB", "打开「Library」库"))
            Button { c.open(.log) } label: { Image(systemName: "doc.text") }.help(c.loc("Log", "日志"))
            Button { c.open(.zotero) } label: { Image(systemName: "books.vertical") }.help("Zotero")
            Button { c.open(.project) } label: { Image(systemName: "folder") }.help(c.loc("Project folder", "项目文件夹"))
            Spacer()
            Button { c.setLang(c.lang == .zh ? .en : .zh) } label: {
                Image(systemName: "globe")
            }.help(c.loc("切换中文", "Switch to English"))
            Button { Task { await c.tick() } } label: { Image(systemName: "arrow.clockwise") }.help(c.loc("Refresh", "刷新"))
            Button { NSApplication.shared.terminate(nil) } label: { Image(systemName: "power") }.help(c.loc("Quit", "退出"))
        }
        .buttonStyle(.borderless)
        .foregroundStyle(.secondary)
        .padding(.top, 2)
    }
}
