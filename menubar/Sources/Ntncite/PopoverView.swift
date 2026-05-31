import AppKit
import Charts
import SwiftUI

private extension View {
    /// 统一的分区卡片底:浅色圆角背景。
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
                Text("文献同步").font(.headline)
                Text(c.stateText).font(.subheadline).foregroundStyle(c.stateColor)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                if c.status?.pending == true {
                    Text("● 有改动")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.orange)
                }
                Text("\(c.entries.count) 篇 · \(c.status?.notes ?? 0) 笔记")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: BBT 掉线警告(硬依赖)

    private var bbtWarning: some View {
        HStack(spacing: 7) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text("BBT 未连(Zotero 没开?)—— 同步已暂停,citekey / 题录读不到")
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
                        Text(c.isSyncing ? "同步中…" : "立即同步")
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
                .help("强制全量重推(刷新所有元数据)")
            }
            if let err = c.lastError {
                Text("✗ \(err)").font(.caption2).foregroundStyle(.red).lineLimit(2)
            }
        }
    }

    // MARK: 健康胶囊(BBT = Better BibTeX 探活)

    private var healthCard: some View {
        HStack(spacing: 6) {
            healthPill("BBT", c.doctor?.bbt).help("Zotero 开着 + Better BibTeX :23119 活")
            healthPill("ntn", c.doctor?.ntn).help("Notion CLI 已登录")
            healthPill("卷", c.doctor?.volume).help("外置卷已挂载,能读 zotero.sqlite")
            healthPill("Notion", c.doctor?.notion).help("「文献」库可达")
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
            .help(c.launchdLoaded ? "暂停自动同步" : "恢复自动同步")
        }
        .sectionCard()
    }

    // MARK: 分段:条目 / 历史 / 耗时

    private var tabbedCard: some View {
        VStack(spacing: 8) {
            Picker("", selection: $tab) {
                Text("条目 \(c.entries.count)").tag(0)
                Text("历史").tag(1)
                Text("耗时").tag(2)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            switch tab {
            case 0: entriesList
            case 1: historyList
            default: chart
            }
        }
        .sectionCard()
    }

    // MARK: 条目列表(点击跳 Notion 页)

    private var entriesList: some View {
        ScrollView {
            VStack(spacing: 1) {
                if c.entries.isEmpty {
                    Text("(无条目)").font(.caption2).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ForEach(c.entries) { e in
                        Button { c.openPaper(e) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "doc.text")
                                    .font(.caption).foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(e.title).font(.caption.weight(.medium)).lineLimit(1)
                                    Text(entrySubtitle(e))
                                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer(minLength: 6)
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
            .padding(.trailing, 6) // 给滚动条留位,别压着徽标
        }
        .frame(height: 160)
    }

    private func entrySubtitle(_ e: PaperEntry) -> String {
        var parts: [String] = []
        if let ck = e.citekey { parts.append(ck) } else if e.standalone { parts.append("独立笔记") }
        if let y = e.year { parts.append(String(y)) }
        if !e.authors.isEmpty { parts.append(e.authors) }
        return parts.joined(separator: " · ")
    }

    // MARK: 历史

    private var historyList: some View {
        ScrollView {
            VStack(spacing: 2) {
                if c.history.isEmpty {
                    Text("(暂无记录)").font(.caption2).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ForEach(c.history) { h in
                        HStack(spacing: 6) {
                            Text(relativeTime(h.ts)).frame(width: 58, alignment: .leading)
                            Text(triggerMark(h.trigger))
                            Text("+\(h.create) ~\(h.update) =\(h.skip)").foregroundStyle(.secondary)
                            Spacer(minLength: 6)
                            Text(String(format: "%.1fs", h.durationSec))
                            Image(systemName: h.ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundStyle(h.ok ? .green : .red)
                        }
                        .font(.caption2)
                        .padding(.vertical, 1)
                    }
                }
            }
            .padding(.trailing, 6)
        }
        .frame(height: 160)
    }

    private func triggerMark(_ t: String) -> String {
        switch t {
        case "auto": return "🕒"
        case "force": return "⟳"
        default: return "✋"
        }
    }

    // MARK: 耗时柱状图

    private var chart: some View {
        Group {
            if c.history.isEmpty {
                Text("(暂无数据)").font(.caption2).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Chart {
                    ForEach(Array(c.history.prefix(12).reversed().enumerated()), id: \.offset) { item in
                        BarMark(
                            x: .value("run", item.offset),
                            y: .value("秒", item.element.durationSec)
                        )
                        .foregroundStyle(item.element.ok ? Color.accentColor : Color.red)
                        .cornerRadius(3)
                    }
                }
                .chartXAxis(.hidden)
            }
        }
        .frame(height: 160)
    }

    // MARK: 底部

    private var footer: some View {
        HStack(spacing: 16) {
            Button { c.open(.notion) } label: { Image(systemName: "book") }.help("打开「文献」库")
            Button { c.open(.log) } label: { Image(systemName: "doc.text") }.help("日志")
            Button { c.open(.zotero) } label: { Image(systemName: "books.vertical") }.help("Zotero")
            Button { c.open(.project) } label: { Image(systemName: "folder") }.help("项目文件夹")
            Spacer()
            Button { Task { await c.tick() } } label: { Image(systemName: "arrow.clockwise") }.help("刷新")
            Button { NSApplication.shared.terminate(nil) } label: { Image(systemName: "power") }.help("退出")
        }
        .buttonStyle(.borderless)
        .foregroundStyle(.secondary)
        .padding(.top, 2)
    }
}
