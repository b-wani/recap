// swift-tools-version:5.8
import PackageDescription

let package = Package(
    name: "recap-capture",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "recap-capture",
            path: "Sources/recap-capture"
        )
    ]
)
