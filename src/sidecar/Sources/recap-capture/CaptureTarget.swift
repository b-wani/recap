import AppKit
import ScreenCaptureKit

/// 해석된 캡처 대상 — ScreenCaptureKit 필터, 이벤트 좌표 변환용 원점, 프로토콜에 실을
/// 메타데이터를 함께 담는다. 효과 로직은 없다 — 무엇을·어디를 캡처하는지의 기술뿐.
struct ResolvedTarget {
    let kind: String        // "display" | "window"
    let id: String          // "display:<displayID>" | "window:<windowID>"
    let title: String
    let width: Int          // 논리 크기(포인트) = 이벤트 좌표 공간 경계
    let height: Int
    /// 좌상단 글로벌 좌표 원점(포인트). 전역 마우스 좌표를 대상 좌표계로 옮길 때 뺀다.
    let origin: CGPoint
    let filter: SCContentFilter
    let widthPx: Int        // 캡처 해상도(Retina 2x)
    let heightPx: Int

    /// 프로토콜 ready.target / targets 원소로 실을 딕셔너리.
    var meta: [String: Any] {
        ["kind": kind, "id": id, "title": title, "width": width, "height": height]
    }
}

/// 캡처 대상 열거(list)와 해석(record --target)의 단일 지점.
enum CaptureTargets {
    /// SPEC: Retina 2x 원본. 논리 크기(포인트)에 곱해 캡처 픽셀 크기를 얻는다.
    static let scale = 2

    /// list — 선택 가능한 대상(전체 화면 디스플레이 + 열린 창)을 프로토콜 메타로 만든다.
    static func enumerate(_ content: SCShareableContent) -> [[String: Any]] {
        var out: [[String: Any]] = []
        for display in content.displays {
            let w = Int(display.frame.width)
            let h = Int(display.frame.height)
            out.append([
                "kind": "display",
                "id": "display:\(display.displayID)",
                "title": "전체 화면 (\(w)×\(h))",
                "width": w,
                "height": h
            ])
        }
        for window in content.windows where isSelectable(window) {
            out.append([
                "kind": "window",
                "id": "window:\(window.windowID)",
                "title": windowTitle(window),
                "width": Int(window.frame.width),
                "height": Int(window.frame.height)
            ])
        }
        return out
    }

    /// record — id를 현재 공유 콘텐츠에 대응시켜 필터·원점·메타데이터를 만든다.
    /// 대상이 사라졌으면 nil (호출부가 target-not-found로 표면화한다).
    static func resolve(id: String, content: SCShareableContent) -> ResolvedTarget? {
        if id.hasPrefix("display:"), let raw = UInt32(id.dropFirst("display:".count)) {
            guard let display = content.displays.first(where: { $0.displayID == raw }) else { return nil }
            let w = Int(display.frame.width)
            let h = Int(display.frame.height)
            return ResolvedTarget(
                kind: "display", id: id, title: "전체 화면",
                width: w, height: h, origin: display.frame.origin,
                filter: SCContentFilter(display: display, excludingWindows: []),
                widthPx: w * scale, heightPx: h * scale
            )
        }
        if id.hasPrefix("window:"), let raw = UInt32(id.dropFirst("window:".count)) {
            guard let window = content.windows.first(where: { $0.windowID == raw }) else { return nil }
            let w = Int(window.frame.width)
            let h = Int(window.frame.height)
            return ResolvedTarget(
                kind: "window", id: id, title: windowTitle(window),
                width: w, height: h, origin: window.frame.origin,
                // 다른 창에 가려져도 해당 창만 담는다 (SPEC: 창 캡처).
                filter: SCContentFilter(desktopIndependentWindow: window),
                widthPx: w * scale, heightPx: h * scale
            )
        }
        return nil
    }

    /// 사람이 고를 만한 실제 창만 (화면에 보이고, 충분히 크고, 일반 계층).
    private static func isSelectable(_ w: SCWindow) -> Bool {
        guard w.isOnScreen, w.windowLayer == 0 else { return false }
        guard w.frame.width >= 120, w.frame.height >= 120 else { return false }
        return w.owningApplication != nil
    }

    private static func windowTitle(_ w: SCWindow) -> String {
        let app = w.owningApplication?.applicationName ?? "앱"
        if let t = w.title, !t.isEmpty { return "\(app) — \(t)" }
        return app
    }
}
