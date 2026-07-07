import Foundation

/// 사이드카 프로토콜 — Electron 본체와의 명시적 계약(사이드카 쪽 절반).
/// 본체 쪽 계약은 src/main/sidecar/protocol.ts, 문서는 docs/sidecar-protocol.md.
/// 여기에는 효과 로직이 없다 — 메시지를 stdout에 JSONL로 흘리기만 한다.
enum Protocol {
    static let version = 3
}

/// stdout에 JSONL 한 줄을 원자적으로 쓴다. 표준출력은 이벤트 스트림 전용이므로
/// 로그·경고는 절대 stdout에 쓰지 않는다 (stderr 사용).
enum Emitter {
    private static let lock = NSLock()

    static func emit(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              var line = String(data: data, encoding: .utf8) else { return }
        line += "\n"
        lock.lock()
        FileHandle.standardOutput.write(Data(line.utf8))
        lock.unlock()
    }

    /// `list` 응답 — 선택 가능한 캡처 대상 목록. 각 원소는 {kind,id,title,width,height}.
    static func targets(_ targets: [[String: Any]]) {
        emit([
            "type": "targets",
            "protocolVersion": Protocol.version,
            "targets": targets
        ])
    }

    static func ready(rawVideoPath: String, startedAt: Int, target: [String: Any]) {
        emit([
            "type": "ready",
            "protocolVersion": Protocol.version,
            "rawVideoPath": rawVideoPath,
            "startedAt": startedAt,
            "target": target
        ])
    }

    static func event(kind: String, t: Int, x: Double, y: Double, cursor: String) {
        emit(["type": "event", "kind": kind, "t": t, "x": x, "y": y, "cursor": cursor])
    }

    /// 키 입력 하나 — 정규화된 조합 문자열(예: "⌘S"). 마우스 event와 분리된 스트림.
    static func key(t: Int, combo: String) {
        emit(["type": "key", "t": t, "combo": combo])
    }

    static func stopped(rawVideoPath: String, durationMs: Int, eventCount: Int) {
        emit([
            "type": "stopped",
            "rawVideoPath": rawVideoPath,
            "durationMs": durationMs,
            "eventCount": eventCount
        ])
    }

    static func error(code: String, message: String) {
        emit(["type": "error", "code": code, "message": message])
    }
}
