import AVFoundation
import CoreMedia
import ScreenCaptureKit

/// ScreenCaptureKit으로 선택된 대상(전체 화면 또는 특정 창) 원본을 mp4로 기록한다.
/// 효과 로직 없음 — 원본 프레임을 그대로 파일에 쓰기만 한다 (ADR 0001의 불변층).
final class ScreenRecorder: NSObject, SCStreamOutput {
    private let outputURL: URL
    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private let sampleQueue = DispatchQueue(label: "recap.capture.samples")

    private var sessionStarted = false
    private var firstPTS: CMTime = .zero
    private var lastPTS: CMTime = .zero

    init(outputURL: URL) {
        self.outputURL = outputURL
    }

    /// 권한을 확인하고 지정한 대상의 캡처를 시작한다.
    /// 성공하면 해석된 대상과 함께 onReady, 실패면 onError를 호출한다.
    func start(targetId: String,
               onReady: @escaping (_ target: ResolvedTarget) -> Void,
               onError: @escaping (_ code: String, _ message: String) -> Void) {
        SCShareableContent.getWithCompletionHandler { [weak self] content, error in
            guard let self else { return }

            if let error {
                // 화면 녹화 권한 미허용이 가장 흔한 원인. 조용히 실패시키지 않는다.
                onError("permission-denied",
                        "화면 녹화 권한이 필요합니다. 시스템 설정 > 개인정보 보호 및 보안 > 화면 기록에서 허용하세요. (\(error.localizedDescription))")
                return
            }
            guard let content else {
                onError("no-display", "캡처할 대상을 조회하지 못했습니다.")
                return
            }
            guard let target = CaptureTargets.resolve(id: targetId, content: content) else {
                onError("target-not-found",
                        "선택한 대상(\(targetId))을 찾지 못했습니다. 창이 닫혔을 수 있습니다.")
                return
            }

            do {
                try self.beginCapture(target: target, onReady: onReady, onError: onError)
            } catch {
                onError("capture-failed", "캡처 시작 실패: \(error.localizedDescription)")
            }
        }
    }

    private func beginCapture(target: ResolvedTarget,
                              onReady: @escaping (_ target: ResolvedTarget) -> Void,
                              onError: @escaping (_ code: String, _ message: String) -> Void) throws {
        let filter = target.filter

        let config = SCStreamConfiguration()
        config.width = target.widthPx    // Retina 2x (SPEC: Retina 2x 원본)
        config.height = target.heightPx
        config.minimumFrameInterval = CMTime(value: 1, timescale: 60) // 60fps
        config.showsCursor = false          // 시스템 커서 제외, 렌더링 때 다시 그림
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.queueDepth = 6

        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: config.width,
            AVVideoHeightKey: config.height
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw NSError(domain: "recap", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "AVAssetWriter가 비디오 입력을 받지 못함"])
        }
        writer.add(input)
        writer.startWriting()

        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)

        self.writer = writer
        self.videoInput = input
        self.stream = stream

        // 세마포어로 완료를 동기 대기하면 SCShareableContent 완료 핸들러가 도는 큐가
        // 막혀 startCapture 완료 콜백과 데드락한다 (list는 세마포어가 없어 정상).
        // 완료를 콜백으로 이어받아 ready/error를 알린다.
        stream.startCapture { error in
            if let error {
                onError("capture-failed", "캡처 시작 실패: \(error.localizedDescription)")
                return
            }
            onReady(target)
        }
    }

    // MARK: SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid,
              let input = videoInput, let writer else { return }

        // 완전한 프레임만 기록한다 (blank/idle 프레임 제외).
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
              let statusRaw = attachments.first?[.status] as? Int,
              let status = SCFrameStatus(rawValue: statusRaw), status == .complete else { return }

        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if !sessionStarted {
            writer.startSession(atSourceTime: pts)
            firstPTS = pts
            sessionStarted = true
        }
        lastPTS = pts
        if input.isReadyForMoreMediaData {
            input.append(sampleBuffer)
        }
    }

    /// 캡처를 멈추고 파일을 마무리한 뒤 녹화 길이(ms)를 콜백한다.
    func stop(completion: @escaping (_ durationMs: Int) -> Void) {
        stream?.stopCapture { [weak self] _ in
            guard let self else { completion(0); return }
            self.videoInput?.markAsFinished()
            let durationSec = self.sessionStarted
                ? CMTimeGetSeconds(CMTimeSubtract(self.lastPTS, self.firstPTS))
                : 0
            self.writer?.finishWriting {
                completion(Int((durationSec * 1000).rounded()))
            }
        }
    }
}
