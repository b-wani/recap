import AppKit

/// 전역 키 입력을 관찰해 정규화된 조합 문자열을 이벤트 트랙 메시지로 흘린다.
///
/// 프라이버시 경계: 수식키(⌘⌥⇧⌃) 조합과 특수키(Enter/Tab/Esc/화살표/Delete 등)만
/// 캡처한다. 수식키 없는 일반 타이핑 문자(비밀번호·커밋 메시지 본문 등)는 **절대**
/// 캡처하지 않는다 — 조합 문자열만 스트리밍하며, 효과·표시 로직은 여기 없다(ADR 0001).
///
/// 전역 keyDown 관찰은 손쉬운 사용(Accessibility) 권한이 필요하다. 권한이 없으면
/// 조용히 아무 키도 흐르지 않고, 나머지 녹화(원본 영상·마우스)는 그대로 동작한다.
final class KeyTracker {
    private var monitor: Any?
    private let startedAt: TimeInterval
    private let onKey: (_ t: Int, _ combo: String) -> Void

    init(startedAt: TimeInterval,
         onKey: @escaping (_ t: Int, _ combo: String) -> Void) {
        self.startedAt = startedAt
        self.onKey = onKey
    }

    func start() {
        monitor = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown]) { [weak self] event in
            self?.handle(event)
        }
    }

    func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    private func handle(_ event: NSEvent) {
        guard let combo = KeyTracker.normalize(event) else { return }
        let t = Int((Date().timeIntervalSince1970 - startedAt) * 1000)
        onKey(max(0, t), combo)
    }

    /// keyDown 이벤트를 정규화된 조합 문자열로 바꾼다. 캡처 대상이 아니면 nil.
    ///
    /// - 특수키(keyCode 매핑)는 수식키 유무와 무관하게 항상 캡처한다.
    /// - 일반 문자키는 command/option/control 중 하나라도 눌렸을 때만 캡처한다
    ///   (수식키 없는 일반 타이핑은 프라이버시상 버린다). shift만으로는 캡처하지 않는다.
    static func normalize(_ event: NSEvent) -> String? {
        let flags = event.modifierFlags
        let hasShortcutModifier =
            flags.contains(.command) || flags.contains(.option) || flags.contains(.control)

        if let special = specialKeyName(event.keyCode) {
            return modifierPrefix(flags) + special
        }
        guard hasShortcutModifier else { return nil }
        guard let base = baseCharacter(event) else { return nil }
        return modifierPrefix(flags) + base
    }

    /// 수식키 기호를 macOS 관례 순서(⌃⌥⇧⌘)로 잇는다.
    private static func modifierPrefix(_ flags: NSEvent.ModifierFlags) -> String {
        var s = ""
        if flags.contains(.control) { s += "⌃" }
        if flags.contains(.option) { s += "⌥" }
        if flags.contains(.shift) { s += "⇧" }
        if flags.contains(.command) { s += "⌘" }
        return s
    }

    /// 일반 문자키의 표시 문자 — 수식키를 무시한 기본 문자를 대문자로.
    private static func baseCharacter(_ event: NSEvent) -> String? {
        guard let chars = event.charactersIgnoringModifiers, let first = chars.first else {
            return nil
        }
        // 제어문자(예: 이미 특수키로 처리된 것)는 버린다.
        if first.isLetter || first.isNumber || first.isPunctuation || first.isSymbol {
            return String(first).uppercased()
        }
        return nil
    }

    /// 특수키 keyCode → 표시 이름. 목록에 없으면 nil(일반 문자키로 처리).
    private static func specialKeyName(_ keyCode: UInt16) -> String? {
        switch keyCode {
        case 36, 76: return "Enter"    // Return, keypad Enter
        case 48: return "Tab"
        case 53: return "Esc"
        case 51: return "Delete"       // Backspace
        case 117: return "Delete"      // Forward delete
        case 123: return "←"
        case 124: return "→"
        case 125: return "↓"
        case 126: return "↑"
        case 115: return "Home"
        case 119: return "End"
        case 116: return "PageUp"
        case 121: return "PageDown"
        default: return nil
        }
    }
}
