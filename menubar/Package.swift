// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Ntncite",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "Ntncite",
            // Swift 5 语言模式,放宽 Swift 6 严格并发检查(个人工具,够用)
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
