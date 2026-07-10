import AppKit

/// 전역 마우스 이벤트(이동·클릭)를 관찰해 이벤트 트랙 메시지로 흘린다.
/// 좌표는 캡처 대상의 좌상단을 원점으로 하는 대상 좌표계로 변환한다 — 창 녹화 시
/// 클릭 좌표가 창 기준이 되어 자동 줌이 올바른 지점을 확대한다.
/// 키보드가 아닌 마우스 관찰이므로 손쉬운 사용(Accessibility) 권한이 필요 없다.
final class MouseTracker {
    private var monitor: Any?
    private let startedAt: TimeInterval
    private let onEvent: (_ kind: String, _ t: Int, _ x: Double, _ y: Double, _ cursor: String) -> Void

    /// AppKit(좌하단 원점) → CoreGraphics(좌상단 원점) y 뒤집기 상수 = 주 화면 높이(포인트).
    private let flipHeight: CGFloat
    /// 캡처 대상의 좌상단 글로벌 좌표(포인트). 전역 좌표에서 이만큼 뺀다.
    private let targetOrigin: CGPoint
    /// 대상 크기(포인트). nil 이 아니면 이 경계(`[0,w]×[0,h]`) 밖 이벤트는 드롭한다
    /// (v4 Area — crop 밖에서 벌어진 이벤트는 트랙에 싣지 않는다, #72). display/window는 nil.
    private let bounds: CGSize?

    init(startedAt: TimeInterval,
         targetOrigin: CGPoint,
         bounds: CGSize? = nil,
         onEvent: @escaping (_ kind: String, _ t: Int, _ x: Double, _ y: Double, _ cursor: String) -> Void) {
        self.startedAt = startedAt
        self.targetOrigin = targetOrigin
        self.bounds = bounds
        self.onEvent = onEvent
        // NSEvent.mouseLocation은 AppKit 전역(주 화면 좌하단 원점, y가 위로 증가)이고,
        // targetOrigin은 ScreenCaptureKit의 CoreGraphics 전역(주 화면 좌상단 원점, y가 아래로 증가)이다.
        // AppKit y → CG y 변환 상수는 '주 화면(원점 (0,0)) 높이'다. 전체 데스크톱의 max(maxY)를
        // 쓰면 주 화면 위에 놓인 보조 모니터에서 그 차이만큼 커서 y가 밀린다(멀티 모니터 오프셋).
        let primary = NSScreen.screens.first { $0.frame.origin == .zero } ?? NSScreen.screens.first
        self.flipHeight = primary?.frame.height ?? 0
    }

    func start() {
        let mask: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDown, .leftMouseUp,
                                           .leftMouseDragged, .rightMouseDown, .rightMouseUp]
        monitor = NSEvent.addGlobalMonitorForEvents(matching: mask) { [weak self] event in
            self?.handle(event)
        }
    }

    func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    private func handle(_ event: NSEvent) {
        let kind: String
        switch event.type {
        case .leftMouseDown, .rightMouseDown: kind = "down"
        case .leftMouseUp, .rightMouseUp: kind = "up"
        default: kind = "move"
        }
        // NSEvent.mouseLocation은 좌하단 원점. 먼저 좌상단 글로벌 좌표로 뒤집고,
        // 대상 원점을 빼서 대상 좌표계(창이면 창의 좌상단이 0,0)로 옮긴다.
        let loc = NSEvent.mouseLocation
        let x = loc.x - targetOrigin.x
        let y = (flipHeight - loc.y) - targetOrigin.y
        // Area(crop) 대상이면 경계 밖 이벤트는 드롭한다 — 이벤트 좌표 계약([0,w]×[0,h])을 지킨다.
        if let bounds, (x < 0 || y < 0 || x > bounds.width || y > bounds.height) { return }
        let t = Int((Date().timeIntervalSince1970 - startedAt) * 1000)
        // 커서 모양 재현은 효과 층의 관심사이며 전역 시스템 커서 종류를 신뢰성 있게
        // 읽는 API가 없다. 스켈레톤은 arrow로 고정하고, 트랙 스키마는 3종을 담을 수 있게 둔다.
        onEvent(kind, max(0, t), Double(x), Double(y), "arrow")
    }
}
