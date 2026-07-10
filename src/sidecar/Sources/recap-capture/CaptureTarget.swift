import AppKit
import ScreenCaptureKit

/// 좌표 환산 헬퍼 — 사이드카 내부는 ScreenCaptureKit의 CG 전역 좌표(좌상단 원점)를 쓰고,
/// 프로토콜 v4의 frame·sourceRect는 AppKit 전역 좌표(좌하단 원점)로 노출한다(#57 §3·§4, #68).
enum Coords {
    /// AppKit y 뒤집기 상수 = 원점(0,0)에 놓인 주 화면 높이(포인트). MouseTracker와 동일 규약.
    static var flipHeight: CGFloat {
        let primary = NSScreen.screens.first { $0.frame.origin == .zero } ?? NSScreen.screens.first
        return primary?.frame.height ?? 0
    }

    /// CG 좌상단 원점 전역 사각형 → 프로토콜 meta(AppKit 좌하단 원점 전역). x·크기는 그대로.
    static func appKitRectMeta(cgTopLeft r: CGRect) -> [String: Any] {
        ["x": r.origin.x, "y": flipHeight - (r.origin.y + r.height), "width": r.width, "height": r.height]
    }

    /// AppKit 좌하단 원점 전역 사각형 → CG 좌상단 원점 전역 사각형. x·크기는 그대로.
    static func cgTopLeftRect(appKit r: CGRect) -> CGRect {
        CGRect(x: r.origin.x, y: flipHeight - (r.origin.y + r.height), width: r.width, height: r.height)
    }
}

/// 해석된 캡처 대상 — ScreenCaptureKit 필터, 이벤트 좌표 변환용 원점, 프로토콜에 실을
/// 메타데이터를 함께 담는다. 효과 로직은 없다 — 무엇을·어디를 캡처하는지의 기술뿐.
struct ResolvedTarget {
    let kind: String        // "display" | "window"
    let id: String          // "display:<displayID>" | "window:<windowID>"
    let title: String
    let width: Int          // 논리 크기(포인트) = 이벤트 좌표 공간 경계
    let height: Int
    /// 좌상단 글로벌 좌표 원점(포인트). 전역 마우스 좌표를 대상 좌표계로 옮길 때 뺀다.
    /// Area crop이면 crop 사각형의 좌상단(CG 전역)이라, 이벤트 좌표 계약이 display/window와 같다.
    let origin: CGPoint
    let filter: SCContentFilter
    let widthPx: Int        // 캡처 해상도(Retina 2x)
    let heightPx: Int
    /// 캡처에 적용할 crop 사각형(대상 디스플레이 로컬, 좌상단 원점, 포인트). Area일 때만 non-nil.
    let cropRect: CGRect?
    /// ready/targets 메타에 실을 창 프레임(전역 AppKit 좌표, 좌하단 원점). window일 때만.
    let frameMeta: [String: Any]?
    /// ready 메타에 실을 Area crop 사각형(전역 AppKit 좌표). Area일 때만.
    let sourceRectMeta: [String: Any]?

    /// 프로토콜 ready.target / targets 원소로 실을 딕셔너리.
    var meta: [String: Any] {
        var m: [String: Any] = ["kind": kind, "id": id, "title": title, "width": width, "height": height]
        if let frameMeta { m["frame"] = frameMeta }
        if let sourceRectMeta { m["sourceRect"] = sourceRectMeta }
        return m
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
                "height": Int(window.frame.height),
                // v4: 선택 오버레이가 커서 아래 창을 그릴 수 있게 전역 프레임(AppKit 좌하단)을 싣는다.
                "frame": Coords.appKitRectMeta(cgTopLeft: window.frame)
            ])
        }
        return out
    }

    /// record — id를 현재 공유 콘텐츠에 대응시켜 필터·원점·메타데이터를 만든다.
    /// `appKitSourceRect`(전역 AppKit 좌표)가 주어지면 Area crop을 display 대상에 접어 넣는다.
    /// 대상이 사라졌으면 nil (호출부가 target-not-found로 표면화한다).
    static func resolve(id: String, content: SCShareableContent,
                        appKitSourceRect: CGRect? = nil) -> ResolvedTarget? {
        if id.hasPrefix("display:"), let raw = UInt32(id.dropFirst("display:".count)) {
            guard let display = content.displays.first(where: { $0.displayID == raw }) else { return nil }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            // v4 Area: crop을 기존 display 대상에 접는다 — origin=crop 전역 원점, 크기=crop 크기.
            // 이벤트 처리 경로가 display/window와 완전히 동일해진다(#57 §4).
            if let ar = appKitSourceRect {
                let cropGlobal = Coords.cgTopLeftRect(appKit: ar)   // CG 전역 좌상단
                let w = Int(ar.width)
                let h = Int(ar.height)
                return ResolvedTarget(
                    kind: "display", id: id, title: "영역 (\(w)×\(h))",
                    width: w, height: h, origin: cropGlobal.origin,
                    filter: filter, widthPx: w * scale, heightPx: h * scale,
                    // SCStreamConfiguration.sourceRect는 디스플레이 로컬·포인트·좌상단 좌표계다.
                    cropRect: CGRect(x: cropGlobal.origin.x - display.frame.origin.x,
                                     y: cropGlobal.origin.y - display.frame.origin.y,
                                     width: ar.width, height: ar.height),
                    frameMeta: nil,
                    sourceRectMeta: ["x": ar.origin.x, "y": ar.origin.y,
                                     "width": ar.width, "height": ar.height]
                )
            }
            let w = Int(display.frame.width)
            let h = Int(display.frame.height)
            return ResolvedTarget(
                kind: "display", id: id, title: "전체 화면",
                width: w, height: h, origin: display.frame.origin,
                filter: filter, widthPx: w * scale, heightPx: h * scale,
                cropRect: nil, frameMeta: nil, sourceRectMeta: nil
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
                widthPx: w * scale, heightPx: h * scale,
                cropRect: nil,
                // v4: 창 대상도 ready에 전역 프레임을 실어 targets 목록과 일관되게 한다.
                frameMeta: Coords.appKitRectMeta(cgTopLeft: window.frame),
                sourceRectMeta: nil
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
