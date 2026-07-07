import AppKit
import Foundation
import ScreenCaptureKit

/// recap-capture — 선택한 대상(전체 화면 또는 특정 창)의 원본을 기록하고 마우스
/// 이벤트를 스트리밍하는 CLI 사이드카.
///
/// 사용법:
///   recap-capture list                          선택 가능한 캡처 대상 열거
///   recap-capture record --out <폴더> --target <id>   해당 대상 녹화
///     · stdout으로 프로토콜 메시지를 JSONL로 흘린다 (Protocol.swift, docs/sidecar-protocol.md).
///     · stdin에 "stop\n"이 오면 (또는 SIGTERM) 녹화를 마무리하고 종료한다.
///
/// 효과 로직은 여기 없다 — 원본 기록 + 이벤트 스트리밍만 (ADR 0001).

/// SCShareableContent/startCapture 완료 콜백이 안 오면 이 시간 후 error를 뱉고 종료한다.
/// 캡처 클라이언트가 동시에 여러 개 뜨면 replayd 경합으로 콜백이 영영 안 올 수 있는데,
/// 그대로 두면 재연결을 무한 반복하며 CPU를 태우고 부모에게는 아무 신호도 안 간다.
let watchdogSeconds: TimeInterval = 10

final class Session {
    let outputURL: URL
    let targetId: String
    let recorder: ScreenRecorder
    var tracker: MouseTracker?
    var keyTracker: KeyTracker?
    var eventCount = 0
    var ready = false
    var stopping = false

    init(outDir: URL, targetId: String) {
        try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        self.outputURL = outDir.appendingPathComponent("raw.mp4")
        try? FileManager.default.removeItem(at: outputURL)
        self.targetId = targetId
        self.recorder = ScreenRecorder(outputURL: outputURL)
    }

    func run() {
        recorder.start(targetId: targetId, onReady: { [weak self] target in
            guard let self else { return }
            DispatchQueue.main.async { self.onReady(target) }
        }, onError: { code, message in
            Emitter.error(code: code, message: message)
            exit(1)
        })
        DispatchQueue.main.asyncAfter(deadline: .now() + watchdogSeconds) { [weak self] in
            guard let self, !self.ready, !self.stopping else { return }
            Emitter.error(code: "capture-failed",
                          message: "캡처 시작이 \(Int(watchdogSeconds))초 안에 완료되지 않았습니다. 다른 화면 캡처가 진행 중일 수 있습니다 — 잠시 후 다시 시도하세요.")
            exit(1)
        }
    }

    private func onReady(_ target: ResolvedTarget) {
        ready = true
        let startedAt = Date().timeIntervalSince1970
        let tracker = MouseTracker(startedAt: startedAt,
                                   targetOrigin: target.origin) { [weak self] kind, t, x, y, cursor in
            guard let self else { return }
            self.eventCount += 1
            Emitter.event(kind: kind, t: t, x: x, y: y, cursor: cursor)
        }
        tracker.start()
        self.tracker = tracker
        // 키 입력 오버레이용 — 단축키·특수키만 스트리밍한다(eventCount와 분리, 마우스만 집계).
        let keyTracker = KeyTracker(startedAt: startedAt) { t, combo in
            Emitter.key(t: t, combo: combo)
        }
        keyTracker.start()
        self.keyTracker = keyTracker
        Emitter.ready(rawVideoPath: outputURL.path,
                      startedAt: Int((startedAt * 1000).rounded()),
                      target: target.meta)
    }

    func stop() {
        guard !stopping else { return }
        stopping = true
        tracker?.stop()
        keyTracker?.stop()
        recorder.stop { [weak self] durationMs in
            guard let self else { exit(0) }
            Emitter.stopped(rawVideoPath: self.outputURL.path,
                            durationMs: durationMs,
                            eventCount: self.eventCount)
            exit(0)
        }
    }
}

// MARK: - 인자 파싱

func optionValue(_ args: [String], _ name: String) -> String? {
    var i = 0
    while i < args.count {
        if args[i] == name, i + 1 < args.count { return args[i + 1] }
        i += 1
    }
    return nil
}

// MARK: - list 실행

/// 선택 가능한 캡처 대상을 열거해 targets 메시지 하나를 내보내고 종료한다.
func runList() -> Never {
    var completed = false
    SCShareableContent.getWithCompletionHandler { content, error in
        DispatchQueue.main.async {
            completed = true
            if let error {
                Emitter.error(code: "permission-denied",
                              message: "화면 녹화 권한이 필요합니다. 시스템 설정 > 개인정보 보호 및 보안 > 화면 기록에서 허용하세요. (\(error.localizedDescription))")
                exit(1)
            }
            guard let content else {
                Emitter.error(code: "no-display", message: "캡처 대상을 조회하지 못했습니다.")
                exit(1)
            }
            Emitter.targets(CaptureTargets.enumerate(content))
            exit(0)
        }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + watchdogSeconds) {
        guard !completed else { return }
        Emitter.error(code: "capture-failed",
                      message: "캡처 대상 조회가 \(Int(watchdogSeconds))초 안에 완료되지 않았습니다. 다른 화면 캡처가 진행 중일 수 있습니다 — 다시 시도하세요.")
        exit(1)
    }
    RunLoop.main.run()
    fatalError("unreachable")
}

// MARK: - 진입점

let args = CommandLine.arguments

// 메뉴바 상주 도구의 자식이므로 Dock/활성화가 필요 없다.
NSApplication.shared.setActivationPolicy(.prohibited)

switch args.count >= 2 ? args[1] : "" {
case "list":
    runList()

case "record":
    guard let outStr = optionValue(args, "--out") else {
        FileHandle.standardError.write(Data("usage: recap-capture record --out <dir> --target <id>\n".utf8))
        exit(64)
    }
    // --target이 없으면 첫 디스플레이(전체 화면)로 시작한다 — 하위호환/기본값.
    let targetId = optionValue(args, "--target") ?? "display:\(CGMainDisplayID())"
    let session = Session(outDir: URL(fileURLWithPath: outStr), targetId: targetId)

    // stdin에서 "stop" 명령을 기다린다.
    DispatchQueue.global(qos: .userInitiated).async {
        while let line = readLine(strippingNewline: true) {
            if line == "stop" {
                DispatchQueue.main.async { session.stop() }
                break
            }
        }
        // stdin이 닫히면(부모 종료) 안전하게 마무리한다.
        DispatchQueue.main.async { session.stop() }
    }

    // SIGTERM에도 원본 파일을 마무리하고 종료한다.
    signal(SIGTERM, SIG_IGN)
    let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    sigterm.setEventHandler { session.stop() }
    sigterm.resume()

    session.run()
    // 전역 마우스·키 모니터(NSEvent.addGlobalMonitorForEvents)는 AppKit 이벤트 루프가
    // 돌아야 콜백을 받는다 — RunLoop.main.run()만으로는 이벤트가 오지 않아 이벤트 트랙이
    // 항상 비고(커서·자동 줌·키 오버레이가 죽는다), NSApplication.run()으로 돌려야 한다.
    NSApplication.shared.run()

default:
    FileHandle.standardError.write(Data("usage:\n  recap-capture list\n  recap-capture record --out <dir> --target <id>\n".utf8))
    exit(64)
}
