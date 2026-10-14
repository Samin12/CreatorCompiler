import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreImage
import AppKit

// One owned capture session per helper. stdin/stdout are JSON lines; diagnostics
// never share stdout. File destinations come from the trusted desktop adapter.
let outputLock = NSLock()
func emit(_ value: [String: Any]) {
    guard let bytes = try? JSONSerialization.data(withJSONObject: value) else { return }
    outputLock.lock(); FileHandle.standardOutput.write(bytes); FileHandle.standardOutput.write(Data([10])); outputLock.unlock()
}
func failure(_ text: String) -> NSError { NSError(domain: "SceneForgeCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
func seconds(_ time: CMTime) -> Double { CMTimeGetSeconds(time) }
func hostTime() -> CMTime { CMClockGetTime(CMClockGetHostTimeClock()) }
func finite(_ value: Any?, fallback: Double) -> Double { guard let number = value as? NSNumber, number.doubleValue.isFinite else { return fallback }; return number.doubleValue }

// Quartz window bounds are global logical screen coordinates, with the origin
// at the upper-left of the main display. Poll only the explicitly selected ID.
func captureBoundsJSON(_ rect: CGRect) -> [String: Double] {
    ["x": Double(rect.minX), "y": Double(rect.minY), "width": Double(rect.width), "height": Double(rect.height)]
}
func selectedWindowBounds(_ windowID: CGWindowID, ownerPID: pid_t?) -> CGRect? {
    guard let windows = CGWindowListCopyWindowInfo(.optionIncludingWindow, windowID) as? [[String: Any]],
          let window = windows.first(where: { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == windowID }),
          ownerPID == nil || (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == ownerPID,
          let dictionary = window[kCGWindowBounds as String] as? [String: Any],
          let rect = CGRect(dictionaryRepresentation: dictionary as CFDictionary),
          [rect.minX, rect.minY, rect.width, rect.height].allSatisfy({ $0.isFinite }), rect.width > 0, rect.height > 0 else { return nil }
    return rect
}

final class NativeRecording: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let queue = DispatchQueue(label: "sceneforge.native.capture", qos: .userInitiated)
    let videoQueue = DispatchQueue(label: "sceneforge.native.video", qos: .userInitiated)
    let videoLock = NSLock()
    var copyPool: CVPixelBufferPool?
    var pendingVideo: [(CVPixelBuffer, CMTime)] = []
    var videoDrainScheduled = false, peakBufferedVideo = 0, lateVideoFrames = 0
    var videoFailure: String?
    var maxBufferedVideo = 16, maxPoolVideo = 24
    var selfTestFrameMarkers = false
    var lastEncodedVideo = CMTime.invalid
    let previewQueue = DispatchQueue(label: "sceneforge.native.preview", qos: .utility)
    // Built on first preview, on previewQueue only: it is not on the start path.
    lazy var ci = CIContext(options: [.cacheIntermediates: false])
    var stream: SCStream?
    var timer: DispatchSourceTimer?
    var previewEnabled = true
    var captureBounds = CGRect.zero, capturedWindowID: CGWindowID?, capturedWindowPID: pid_t?
    var lastBoundsPoll = -Double.infinity
    var writer: AVAssetWriter?, videoInput: AVAssetWriterInput?, adaptor: AVAssetWriterInputPixelBufferAdaptor?
    var audioFile: FileHandle?, audioFrames: Int64 = 0, audioFailure: String?
    var latest: CVPixelBuffer?
    var origin: CMTime?, pauseAt: CMTime?, pauseOffset = CMTime.zero
    var lastVideo = CMTime.invalid, lastAudio = CMTime.invalid
    var resumedAt = CMTime.invalid
    var fps: Int32 = 30, width = 0, height = 0
    var videoPath = "", audioPath = "", previewPath = ""
    var recordVideo = true, captureAudio = false, stopping = false, started = false, previewBusy = false
    var previewCounter = 0, lastPreview = -Double.infinity, videoFrames = 0, audioBuffers = 0, droppedVideo = 0, droppedAudio = 0

    // Production and generated diagnostics must exercise the same encoder
    // configuration. Default H264 frame reordering is not our recording path.
    func prepareVideoWriter() throws {
        let w = try AVAssetWriter(outputURL: URL(fileURLWithPath: videoPath), fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: max(1_000_000, width*height*Int(fps)/8), AVVideoMaxKeyFrameIntervalKey: Int(fps)*2, AVVideoAllowFrameReorderingKey: false]])
        input.expectsMediaDataInRealTime = true
        guard w.canAdd(input) else { throw failure("Native video encoder is unavailable.") }; w.add(input)
        adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height])
        writer = w; videoInput = input
        // Copy only into a bounded pool: retaining ScreenCaptureKit's own
        // three surfaces while an encoder stalls can stop source delivery.
        // The encoder retains its own in-flight surfaces in addition to the
        // waiting queue. Account for both under a 256 MiB pixel budget.
        maxPoolVideo = min(64,max(4,256*1024*1024/max(1,width*height*4)))
        let encoderReserve=min(8,maxPoolVideo/2)
        maxBufferedVideo = min(30,maxPoolVideo-encoderReserve)
        let poolAttributes = [kCVPixelBufferPoolMinimumBufferCountKey: 3] as CFDictionary
        let pixelAttributes = [kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32BGRA,kCVPixelBufferWidthKey as String:width,kCVPixelBufferHeightKey as String:height,kCVPixelBufferIOSurfacePropertiesKey as String:[:]] as CFDictionary
        guard CVPixelBufferPoolCreate(kCFAllocatorDefault,poolAttributes,pixelAttributes,&copyPool) == kCVReturnSuccess else { throw failure("Could not create the bounded recording frame pool.") }
    }

    func enqueueVideo(_ image: CVPixelBuffer, at pts: CMTime) {
        videoLock.lock(); let available = pendingVideo.count < maxBufferedVideo && videoFailure == nil; videoLock.unlock()
        guard available, let copyPool, CVPixelBufferGetWidth(image)==width, CVPixelBufferGetHeight(image)==height, CVPixelBufferGetPixelFormatType(image)==kCVPixelFormatType_32BGRA else { droppedVideo += 1; return }
        var copied: CVPixelBuffer?
        let auxiliary = [kCVPixelBufferPoolAllocationThresholdKey: maxPoolVideo] as CFDictionary
        guard CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault,copyPool,auxiliary,&copied) == kCVReturnSuccess, let copied else { droppedVideo += 1; return }
        CVPixelBufferLockBaseAddress(image,.readOnly); CVPixelBufferLockBaseAddress(copied,[])
        var copiedPixels=false
        if let src = CVPixelBufferGetBaseAddress(image), let dst = CVPixelBufferGetBaseAddress(copied) {
            let sourceStride=CVPixelBufferGetBytesPerRow(image),targetStride=CVPixelBufferGetBytesPerRow(copied)
            for row in 0..<min(CVPixelBufferGetHeight(image),CVPixelBufferGetHeight(copied)) { memcpy(dst.advanced(by:row*targetStride),src.advanced(by:row*sourceStride),min(sourceStride,targetStride)) }
            copiedPixels=true
        }
        CVPixelBufferUnlockBaseAddress(copied,[]); CVPixelBufferUnlockBaseAddress(image,.readOnly)
        guard copiedPixels else { droppedVideo += 1; return }
        videoLock.lock(); pendingVideo.append((copied,pts)); peakBufferedVideo=max(peakBufferedVideo,pendingVideo.count); let schedule = !videoDrainScheduled; videoDrainScheduled=true; videoLock.unlock()
        if schedule { videoQueue.async { self.drainVideo() } }
    }

    func drainVideo() {
        while videoInput?.isReadyForMoreMediaData == true {
            videoLock.lock()
            guard !pendingVideo.isEmpty else { videoDrainScheduled=false; videoLock.unlock(); return }
            let frame=pendingVideo.removeFirst(); videoLock.unlock()
            if adaptor?.append(frame.0,withPresentationTime:frame.1) == true { videoFrames += 1; lastEncodedVideo=frame.1 }
            else {
                videoLock.lock(); videoFailure=writer?.error?.localizedDescription ?? "Video write failed."; pendingVideo.removeAll(); videoDrainScheduled=false; videoLock.unlock()
                emit(["type":"error","message":videoFailure!]); return
            }
        }
        videoLock.lock(); let retry = !pendingVideo.isEmpty && videoFailure == nil; if !retry { videoDrainScheduled=false }; videoLock.unlock()
        if retry { videoQueue.asyncAfter(deadline:.now()+0.005) { self.drainVideo() } }
    }

    func videoDrained() -> Bool { videoLock.lock(); defer {videoLock.unlock()}; return !videoDrainScheduled && pendingVideo.isEmpty }


    func start(_ config: [String: Any]) async throws {
        guard stream == nil else { throw failure("A capture session is already running.") }
        guard let directory = config["directory"] as? String, directory.hasPrefix("/") else { throw failure("An absolute output directory is required.") }
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        videoPath = directory + "/screen.mp4"; audioPath = directory + "/system.wav"; previewPath = directory + "/preview.jpg"
        recordVideo = config["recordVideo"] as? Bool ?? true; captureAudio = config["systemAudio"] as? Bool ?? false
        guard recordVideo || captureAudio else { throw failure("Choose screen recording or system audio.") }
        fps = Int32(min(60, max(10, finite(config["fps"], fallback: 30))))
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        var excluded = Set((config["excludePids"] as? [Int] ?? []).map { pid_t($0) }); excluded.insert(getpid())
        let applications = content.applications.filter { excluded.contains($0.processID) || $0.bundleIdentifier == "com.samin.sceneforge" }
        let filter: SCContentFilter
        var rect: CGRect
        if let windowID = config["windowId"] as? UInt32 {
            guard let window = content.windows.first(where: { $0.windowID == windowID }) else { throw failure("The chosen window is no longer available.") }
            if let owner = window.owningApplication, excluded.contains(owner.processID) || owner.bundleIdentifier == "com.samin.sceneforge" { throw failure("SceneForge windows are excluded from native recording. Choose another window or a display.") }
            capturedWindowID = windowID; capturedWindowPID = window.owningApplication?.processID
            captureBounds = selectedWindowBounds(windowID, ownerPID: capturedWindowPID) ?? window.frame
            filter = SCContentFilter(desktopIndependentWindow: window)
            rect = CGRect(origin: .zero, size: window.frame.size)
        } else {
            let displayID = (config["displayId"] as? UInt32) ?? CGMainDisplayID()
            guard let display = content.displays.first(where: { $0.displayID == displayID }) else { throw failure("The chosen display is no longer connected.") }
            let requestedHosts = config["excludePids"] as? [Int] ?? []
            guard requestedHosts.allSatisfy({ pid in applications.contains(where: { $0.processID == pid_t(pid) }) }) else { throw failure("SceneForge could not be identified for screen exclusion. Keep its main window visible while starting capture, then retry.") }
            filter = SCContentFilter(display: display, excludingApplications: applications, exceptingWindows: [])
            captureBounds = display.frame
            rect = CGRect(x: 0, y: 0, width: display.frame.width, height: display.frame.height)
        }
        if let crop = config["region"] as? [String: Any] {
            let x = finite(crop["x"], fallback: -1), y = finite(crop["y"], fallback: -1), w = finite(crop["width"], fallback: 0), h = finite(crop["height"], fallback: 0)
            guard x >= 0, y >= 0, w > 0, h > 0, x + w <= 1.000001, y + h <= 1.000001 else { throw failure("Invalid normalized capture region.") }
            rect = CGRect(x: rect.width*x, y: rect.height*y, width: rect.width*w, height: rect.height*h)
            captureBounds = CGRect(x: captureBounds.minX+rect.minX, y: captureBounds.minY+rect.minY, width: rect.width, height: rect.height)
        }
        let pixelScale = max(1, Double(filter.pointPixelScale))
        let requestedMax = min(4096, max(320, finite(config["maxDimension"], fallback: 1920)))
        let scale = min(pixelScale, requestedMax/max(rect.width, rect.height))
        width = max(2, Int(rect.width*scale)/2*2); height = max(2, Int(rect.height*scale)/2*2)
        let options = SCStreamConfiguration()
        options.width = width; options.height = height; options.sourceRect = rect
        options.minimumFrameInterval = CMTime(value: 1, timescale: fps); options.queueDepth = 3
        options.pixelFormat = kCVPixelFormatType_32BGRA; options.showsCursor = true
        options.scalesToFit = true; options.preservesAspectRatio = true
        options.capturesAudio = captureAudio; options.excludesCurrentProcessAudio = true
        options.sampleRate = 48000; options.channelCount = 2
        if recordVideo { try prepareVideoWriter() }
        if captureAudio {
            try beginAudio()
        }
        let session = SCStream(filter: filter, configuration: options, delegate: self)
        try session.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        if captureAudio { try session.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue) }
        stream = session
        try await session.startCapture()
        // `started` is emitted with the first complete frame, not merely after
        // permission/stream setup. Browser tracks can align to this wall time.
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) { emit(["type": "error", "message": error.localizedDescription]); Task { await stop() } }
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        accept(sample, type: type)
    }
    func accept(_ sample: CMSampleBuffer, type: SCStreamOutputType) {
        guard !stopping, CMSampleBufferIsValid(sample), CMSampleBufferDataIsReady(sample) else { return }
        if type == .screen {
            guard let image = sample.imageBuffer else { return }
            if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]], let status = attachments.first?[.status] as? Int, status != SCFrameStatus.complete.rawValue { return }
            latest = image
            if origin == nil {
                origin = hostTime()
                let originEpochMs = Date().timeIntervalSince1970*1000
                if let writer, !writer.startWriting() { emit(["type":"error","message":writer.error?.localizedDescription ?? "Video encoder could not start."]); return }; writer?.startSession(atSourceTime: .zero)
                started = true
                emit(["type":"started","startedAtMs":originEpochMs,"width":width,"height":height,"excludesSceneForge":true,"captureBounds":captureBoundsJSON(captureBounds),"previewControl":true])
                tick()
                // Frames arrive phase-locked to this first one; sample mid-interval
                // of the origin grid (encoder start above may have taken a while).
                let position = seconds(elapsed())*Double(fps); var delay = 0.5-(position-floor(position)); if delay <= 0 { delay += 1 }
                let t = DispatchSource.makeTimerSource(queue: queue); t.schedule(deadline: .now()+delay/Double(fps), repeating: 1/Double(fps), leeway: .milliseconds(1)); t.setEventHandler { [weak self] in self?.tick() }; timer = t; t.resume()
            }
        } else if type == .audio {
            guard origin != nil, pauseAt == nil, audioFile != nil else { return }
            let original = CMSampleBufferGetPresentationTimeStamp(sample)
            if resumedAt.isValid && original < resumedAt { return }
            let pts = CMTimeSubtract(CMTimeSubtract(original, origin!), pauseOffset)
            guard !lastAudio.isValid || pts > lastAudio else { return }
            do { try appendAudio(sample, pts: pts); lastAudio = pts; audioBuffers += 1 }
            catch { audioFailure=error.localizedDescription; emit(["type":"error","message":error.localizedDescription]) }
        }
    }
    func beginAudio() throws {
        guard !FileManager.default.fileExists(atPath: audioPath), FileManager.default.createFile(atPath: audioPath, contents: Data(count:44), attributes:[.posixPermissions:0o600]) else { throw failure("Could not create system-audio output.") }
        audioFile=try FileHandle(forWritingTo:URL(fileURLWithPath:audioPath));try audioFile!.seek(toOffset:44)
    }
    func fillAudio(until target:Int64) throws {
        guard target <= 1_073_741_800 else { throw failure("System audio reached the WAV file size limit.") }
        while audioFrames < target {let count=Int(min(16384,target-audioFrames));try audioFile!.write(contentsOf:Data(count:count*4));audioFrames+=Int64(count)}
    }
    func appendAudio(_ sample:CMSampleBuffer,pts:CMTime) throws {
        guard let description=sample.formatDescription, let asbd=CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee,
              asbd.mFormatID == kAudioFormatLinearPCM, abs(asbd.mSampleRate-48000)<1, asbd.mChannelsPerFrame==2 else { throw failure("ScreenCaptureKit returned an unsupported system-audio format.") }
        let frames=CMSampleBufferGetNumSamples(sample),position=Int64((seconds(pts)*48000).rounded()),skip=Int(max(0,audioFrames-position))
        guard position >= -48000, position <= Int64((seconds(elapsed())+2)*48000) else {throw failure("System audio timestamps do not match the capture clock.")}
        if skip>=frames{return};try fillAudio(until:max(0,position))
        var needed=0;var retained:CMBlockBuffer?
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample,bufferListSizeNeededOut:&needed,bufferListOut:nil,bufferListSize:0,blockBufferAllocator:kCFAllocatorDefault,blockBufferMemoryAllocator:kCFAllocatorDefault,flags:0,blockBufferOut:nil)
        let raw=UnsafeMutableRawPointer.allocate(byteCount:needed,alignment:MemoryLayout<AudioBufferList>.alignment);defer{raw.deallocate()}
        let list=raw.assumingMemoryBound(to:AudioBufferList.self)
        guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample,bufferListSizeNeededOut:nil,bufferListOut:list,bufferListSize:needed,blockBufferAllocator:kCFAllocatorDefault,blockBufferMemoryAllocator:kCFAllocatorDefault,flags:0,blockBufferOut:&retained)==noErr else {throw failure("Could not read system-audio samples.")}
        let buffers=UnsafeMutableAudioBufferListPointer(list),isFloat=asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0
        guard buffers.count==1 || buffers.count==2, (isFloat && asbd.mBitsPerChannel==32) || (!isFloat && asbd.mBitsPerChannel==16) else {throw failure("Unsupported system-audio sample layout.")}
        var samples=[Int16](repeating:0,count:(frames-skip)*2)
        for frame in skip..<frames {for channel in 0..<2 {let buffer=buffers[buffers.count==1 ? 0:channel],index=frame*Int(buffer.mNumberChannels)+(buffers.count==1 ? channel:0)
            guard let data=buffer.mData,index*Int(asbd.mBitsPerChannel/8)+Int(asbd.mBitsPerChannel/8)<=Int(buffer.mDataByteSize) else {throw failure("Incomplete system-audio sample buffer.")}
            let value:Int16
            if isFloat {let f=data.assumingMemoryBound(to:Float.self)[index];value=Int16(max(-32768,min(32767,(f.isFinite ? Double(f):0)*32767)))} else {value=data.assumingMemoryBound(to:Int16.self)[index]}
            samples[(frame-skip)*2+channel]=value.littleEndian
        }}
        try samples.withUnsafeBytes{try audioFile!.write(contentsOf:$0)};audioFrames+=Int64(frames-skip)
    }
    func finishAudio(duration:Double) throws {
        guard let file=audioFile else{return};let target=Int64((duration*48000).rounded());try fillAudio(until:target)
        try file.truncate(atOffset:UInt64(44+target*4));audioFrames=target
        var header=Data("RIFF".utf8)
        func u32(_ value:UInt32){var v=value.littleEndian;withUnsafeBytes(of:&v){header.append(contentsOf:$0)}}
        func u16(_ value:UInt16){var v=value.littleEndian;withUnsafeBytes(of:&v){header.append(contentsOf:$0)}}
        u32(UInt32(36+target*4));header.append(contentsOf:Data("WAVEfmt ".utf8));u32(16);u16(1);u16(2);u32(48000);u32(192000);u16(4);u16(16);header.append(contentsOf:Data("data".utf8));u32(UInt32(target*4))
        try file.seek(toOffset:0);try file.write(contentsOf:header);try file.synchronize();try file.close();audioFile=nil
    }
    func elapsed(at: CMTime? = nil) -> CMTime { guard let origin else { return .zero }; return CMTimeMaximum(.zero, CMTimeSubtract(CMTimeSubtract(at ?? pauseAt ?? hostTime(), origin), pauseOffset)) }
    func updateWindowBounds() {
        guard recordVideo, !stopping, let windowID = capturedWindowID else { return }
        let now = ProcessInfo.processInfo.systemUptime
        guard now-lastBoundsPoll >= 0.5 else { return }; lastBoundsPoll = now
        guard let rect = selectedWindowBounds(windowID, ownerPID: capturedWindowPID), rect != captureBounds else { return }
        captureBounds = rect
        emit(["type":"bounds","captureBounds":captureBoundsJSON(rect)])
    }
    func tick() {
        // The recording timer remains active while paused; keep border metadata
        // current without recording frames or querying any other window.
        updateWindowBounds()
        guard !stopping, pauseAt == nil, let image = latest, origin != nil else { return }
        let time = elapsed(), frame = lastVideo.isValid ? Int64(floor(seconds(time)*Double(fps))) : 0, pts = CMTime(value: frame, timescale: fps)
        if recordVideo && (!lastVideo.isValid || pts > lastVideo) {
            if lastVideo.isValid { lateVideoFrames += max(0,Int(frame-lastVideo.value)-1) }
            if selfTestFrameMarkers {
                // A changing diagnostic source reveals accidental aliasing of
                // queued pixels. Real capture never mutates source surfaces.
                let level=UInt32(32+Int(frame%16)*12),pixel=UInt32(0xff000000)|(level<<16)|(level<<8)|level
                CVPixelBufferLockBaseAddress(image,[])
                if let base=CVPixelBufferGetBaseAddress(image) {base.assumingMemoryBound(to:UInt32.self).initialize(repeating:pixel,count:CVPixelBufferGetBytesPerRow(image)*CVPixelBufferGetHeight(image)/4)}
                CVPixelBufferUnlockBaseAddress(image,[])
            }
            enqueueVideo(image,at:pts); lastVideo=pts
        }
        if previewEnabled && seconds(time)-lastPreview >= 0.2 && !previewBusy {
            previewBusy = true; lastPreview = seconds(time); previewCounter += 1
            let index = previewCounter, file = previewPath
            previewQueue.async { [weak self] in
                guard let self else { return }
                let source = CIImage(cvPixelBuffer: image), scale = min(1, 640/source.extent.width)
                let small = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                if let data = self.ci.jpegRepresentation(of: small, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.65]) {
                    do { try data.write(to: URL(fileURLWithPath: file), options: .atomic); emit(["type":"preview","path":file,"sequence":index,"width":Int(small.extent.width),"height":Int(small.extent.height)]) } catch {}
                }
                self.queue.async { self.previewBusy = false }
            }
        }
    }
    func setPreview(_ enabled: Bool) { queue.async { self.previewEnabled = enabled; if enabled { self.lastPreview = -Double.infinity } } }
    func pause() { queue.async { guard self.started, self.pauseAt == nil, !self.stopping else { return }; self.tick(); self.pauseAt = hostTime(); emit(["type":"paused","duration":seconds(self.elapsed()),"transitionAtMs":Date().timeIntervalSince1970*1000]) } }
    func resume() { queue.async { guard let paused = self.pauseAt, !self.stopping else { return }; let now = hostTime(); self.pauseOffset = CMTimeAdd(self.pauseOffset, CMTimeSubtract(now, paused)); self.resumedAt = now; self.pauseAt = nil; emit(["type":"resumed","duration":seconds(self.elapsed()),"transitionAtMs":Date().timeIntervalSince1970*1000]) } }
    func stop() async {
        let duration: Double = await withCheckedContinuation { continuation in queue.async {
            if self.stopping { continuation.resume(returning: -1); return }
            let d = seconds(self.elapsed()); self.stopping = true; self.timer?.cancel(); self.timer = nil
            continuation.resume(returning: d)
        } }
        if duration < 0 { return }
        try? await stream?.stopCapture()
        // Capture/audio delivery never waits on encoder readiness. Finalization
        // does wait for the bounded backlog, and fails explicitly if it stalls.
        let drainDeadline=ProcessInfo.processInfo.systemUptime+3
        while !videoDrained() && ProcessInfo.processInfo.systemUptime < drainDeadline { try? await Task.sleep(nanoseconds:10_000_000) }
        guard videoDrained() else { emit(["type":"error","message":"The video encoder did not finish buffered frames within three seconds."]); exit(1) }
        // A warned overflow must not silently shorten video relative to audio.
        // Hold the final available image at the last complete frame boundary.
        let terminalPTS=CMTime(value:max(0,Int64(floor(duration*Double(fps)))-1),timescale:fps)
        if recordVideo, latest != nil, !lastEncodedVideo.isValid || lastEncodedVideo < terminalPTS {
            await withCheckedContinuation { (continuation:CheckedContinuation<Void,Never>) in queue.async {if let image=self.latest {self.enqueueVideo(image,at:terminalPTS)};continuation.resume()} }
            let terminalDeadline=ProcessInfo.processInfo.systemUptime+3
            while !videoDrained() && ProcessInfo.processInfo.systemUptime < terminalDeadline {try? await Task.sleep(nanoseconds:10_000_000)}
            guard videoDrained() else {emit(["type":"error","message":"The video encoder did not finalize the last frame."]);exit(1)}
        }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in queue.async {
            let end = CMTime(seconds: max(duration,1/Double(self.fps)), preferredTimescale: 60000)
            if self.started {
                self.writer?.endSession(atSourceTime: end); self.videoInput?.markAsFinished()
            } else { self.writer?.cancelWriting() }
            do {try self.finishAudio(duration:duration)} catch {self.audioFailure=error.localizedDescription}
            continuation.resume()
        } }
        if let writer, writer.status == .writing { await writer.finishWriting() }
        var result: [String: Any] = ["type":"stopped","duration":duration,"width":width,"height":height,"excludesSceneForge":true,"videoFrames":videoFrames,"audioBuffers":audioBuffers,"droppedVideo":droppedVideo,"droppedAudio":droppedAudio,"peakBufferedVideo":peakBufferedVideo,"lateVideoFrames":lateVideoFrames,"maxBufferedVideo":maxBufferedVideo,"maxPoolVideo":maxPoolVideo]
        if recordVideo, writer?.status == .completed, videoFrames > 0 { result["videoPath"] = videoPath }
        if captureAudio, audioFailure == nil, audioBuffers > 0 { result["audioPath"] = audioPath }
        if captureAudio && audioBuffers == 0 { result["warning"] = "No system-audio samples were received; no system audio file was imported." }
        if droppedVideo+lateVideoFrames > 0 { result["warning"] = [result["warning"] as? String,"Recording was under load: \(droppedVideo) video frames exceeded the buffer and \(lateVideoFrames) frame intervals were delayed. Review the take before using it."].compactMap{$0}.joined(separator:" ") }
        if let error = writer?.error { result["error"] = error.localizedDescription };if let videoFailure {result["error"]=videoFailure};if let audioFailure {result["error"]=audioFailure}
        emit(result)
        exit(result["error"] == nil ? 0 : 1)
    }
}

if CommandLine.arguments.contains("--version") { emit(["version":1,"engine":"ScreenCaptureKit","excludesSceneForge":true,"minimumMacOS":"14.0"]); exit(0) }
let recorder = NativeRecording()
// A deterministic generated-media acceptance mode exercises the same video,
// audio-retiming, pause and finalization paths without screen/TCC access.
if let at = CommandLine.arguments.firstIndex(of: "--self-test"), CommandLine.arguments.count > at+1 {
    let dir = CommandLine.arguments[at+1]
    do {
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        recorder.width=CommandLine.arguments.contains("--self-test-hd") ? 1920 : 320
        recorder.height=CommandLine.arguments.contains("--self-test-hd") ? 1080 : 180; recorder.captureAudio=true
        // A moving source delivers numbered frames on its own clock, as
        // ScreenCaptureKit does, to measure sampling cadence (duplicates/skips).
        var sourceFPS=0.0
        if let index=CommandLine.arguments.firstIndex(of:"--self-test-source-fps"),CommandLine.arguments.count>index+1 {sourceFPS=min(120,max(0,Double(CommandLine.arguments[index+1]) ?? 0))}
        recorder.selfTestFrameMarkers=sourceFPS==0
        var stallMilliseconds=0
        if let index=CommandLine.arguments.firstIndex(of:"--self-test-stall-ms"),CommandLine.arguments.count>index+1 {stallMilliseconds=min(2000,max(0,Int(CommandLine.arguments[index+1]) ?? 0))}
        recorder.videoPath=dir+"/screen.mp4"; recorder.audioPath=dir+"/system.wav"; recorder.previewPath=dir+"/preview.jpg"
        try recorder.prepareVideoWriter()
        emit(["type":"self-test-config","videoSettings":recorder.videoInput?.outputSettings ?? [:],"realTime":recorder.videoInput?.expectsMediaDataInRealTime ?? false,"injectedVideoDelayMs":stallMilliseconds])
        if stallMilliseconds>0 { let delay=Double(stallMilliseconds)/1000; recorder.videoQueue.asyncAfter(deadline:.now()+0.2){Thread.sleep(forTimeInterval:delay)} }
        try recorder.beginAudio()
        var pixel:CVPixelBuffer?;CVPixelBufferCreate(kCFAllocatorDefault,recorder.width,recorder.height,kCVPixelFormatType_32BGRA,[kCVPixelBufferIOSurfacePropertiesKey:[:]] as CFDictionary,&pixel)
        CVPixelBufferLockBaseAddress(pixel!,[]);memset(CVPixelBufferGetBaseAddress(pixel!),100,CVPixelBufferGetDataSize(pixel!));CVPixelBufferUnlockBaseAddress(pixel!,[])
        var vf:CMVideoFormatDescription?;CMVideoFormatDescriptionCreateForImageBuffer(allocator:kCFAllocatorDefault,imageBuffer:pixel!,formatDescriptionOut:&vf)
        var vt=CMSampleTimingInfo(duration:CMTime(value:1,timescale:30),presentationTimeStamp:hostTime(),decodeTimeStamp:.invalid),vs:CMSampleBuffer?
        CMSampleBufferCreateReadyWithImageBuffer(allocator:kCFAllocatorDefault,imageBuffer:pixel!,formatDescription:vf!,sampleTiming:&vt,sampleBufferOut:&vs)
        let sourceTimer=sourceFPS>0 ? DispatchSource.makeTimerSource(queue:DispatchQueue(label:"sceneforge.native.self-test-source",qos:.userInitiated)) : nil
        if let sourceTimer {
            var pool:CVPixelBufferPool?,sourceIndex=0
            CVPixelBufferPoolCreate(kCFAllocatorDefault,[kCVPixelBufferPoolMinimumBufferCountKey:3] as CFDictionary,[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32BGRA,kCVPixelBufferWidthKey as String:recorder.width,kCVPixelBufferHeightKey as String:recorder.height,kCVPixelBufferIOSurfacePropertiesKey as String:[:]] as CFDictionary,&pool)
            sourceTimer.schedule(deadline:.now(),repeating:1/sourceFPS,leeway:.nanoseconds(0))
            sourceTimer.setEventHandler {
                var frame:CVPixelBuffer?;guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault,pool!,&frame)==kCVReturnSuccess,let frame else {return}
                CVPixelBufferLockBaseAddress(frame,[]);memset(CVPixelBufferGetBaseAddress(frame),Int32(32+sourceIndex%16*12),CVPixelBufferGetDataSize(frame));CVPixelBufferUnlockBaseAddress(frame,[]);sourceIndex+=1
                var timing=CMSampleTimingInfo(duration:CMTime(value:1,timescale:30),presentationTimeStamp:hostTime(),decodeTimeStamp:.invalid),sample:CMSampleBuffer?
                CMSampleBufferCreateReadyWithImageBuffer(allocator:kCFAllocatorDefault,imageBuffer:frame,formatDescription:vf!,sampleTiming:&timing,sampleBufferOut:&sample)
                if let sample {recorder.queue.async {recorder.accept(sample,type:.screen)}}
            };sourceTimer.resume()
        } else { recorder.queue.async {recorder.accept(vs!,type:.screen)} }
        let audioTimer=DispatchSource.makeTimerSource(queue:recorder.queue);var sampleIndex:Int64=0
        var asbd=AudioStreamBasicDescription(mSampleRate:48000,mFormatID:kAudioFormatLinearPCM,mFormatFlags:kAudioFormatFlagIsFloat|kAudioFormatFlagIsPacked,mBytesPerPacket:8,mFramesPerPacket:1,mBytesPerFrame:8,mChannelsPerFrame:2,mBitsPerChannel:32,mReserved:0)
        var af:CMAudioFormatDescription?;CMAudioFormatDescriptionCreate(allocator:kCFAllocatorDefault,asbd:&asbd,layoutSize:0,layout:nil,magicCookieSize:0,magicCookie:nil,extensions:nil,formatDescriptionOut:&af)
        audioTimer.schedule(deadline:.now()+0.03,repeating:0.01)
        audioTimer.setEventHandler {
            var samples=[Float](repeating:0,count:960);for i in 0..<480 {let value=Float(sin(Double(sampleIndex+Int64(i))*2*Double.pi*440/48000)*0.1);samples[i*2]=value;samples[i*2+1]=value};sampleIndex+=480
            var block:CMBlockBuffer?;CMBlockBufferCreateWithMemoryBlock(allocator:kCFAllocatorDefault,memoryBlock:nil,blockLength:samples.count*4,blockAllocator:kCFAllocatorDefault,customBlockSource:nil,offsetToData:0,dataLength:samples.count*4,flags:0,blockBufferOut:&block)
            samples.withUnsafeBytes {bytes in _=CMBlockBufferReplaceDataBytes(with:bytes.baseAddress!,blockBuffer:block!,offsetIntoDestination:0,dataLength:bytes.count)}
            var timing=CMSampleTimingInfo(duration:CMTime(value:1,timescale:48000),presentationTimeStamp:hostTime(),decodeTimeStamp:.invalid),sample:CMSampleBuffer?,size=8
            CMSampleBufferCreateReady(allocator:kCFAllocatorDefault,dataBuffer:block,formatDescription:af,sampleCount:480,sampleTimingEntryCount:1,sampleTimingArray:&timing,sampleSizeEntryCount:1,sampleSizeArray:&size,sampleBufferOut:&sample)
            if let sample {recorder.accept(sample,type:.audio)}
        };audioTimer.resume()
        let span=sourceFPS>0 ? 3.0 : 1.0
        DispatchQueue.main.asyncAfter(deadline:.now()+0.8*span){recorder.pause()}
        DispatchQueue.main.asyncAfter(deadline:.now()+1.4*span){recorder.resume()}
        DispatchQueue.main.asyncAfter(deadline:.now()+2.2*span){audioTimer.cancel();sourceTimer?.cancel();Task{await recorder.stop()}}
        RunLoop.main.run()
    } catch {emit(["type":"error","message":error.localizedDescription]);exit(1)}
    exit(0)
}
// Pay AVFoundation's first-writer setup while the helper waits for its start
// command or for ScreenCaptureKit. This throwaway writer is never started.
DispatchQueue.global(qos: .userInitiated).async {
    let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("sceneforge-warmup-\(getpid())-\(UUID().uuidString).mp4")
    if let writer = try? AVAssetWriter(outputURL: url, fileType: .mp4) {
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 1920, AVVideoHeightKey: 1080, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 7_776_000, AVVideoMaxKeyFrameIntervalKey: 60, AVVideoAllowFrameReorderingKey: false]])
        input.expectsMediaDataInRealTime = true
        if writer.canAdd(input) { writer.add(input); _ = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: 1920, kCVPixelBufferHeightKey as String: 1080]) }
    }
    try? FileManager.default.removeItem(at: url)
}
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        do {
            guard line.utf8.count < 65536, let data = line.data(using: .utf8), let message = try JSONSerialization.jsonObject(with: data) as? [String: Any], let command = message["command"] as? String else { throw failure("Invalid capture command.") }
            switch command {
            case "start": Task { do { try await recorder.start(message) } catch { emit(["type":"error","message":error.localizedDescription]); exit(1) } }
            case "pause": recorder.pause()
            case "resume": recorder.resume()
            case "preview": guard let enabled = message["enabled"] as? Bool else { throw failure("Invalid preview command.") }; recorder.setPreview(enabled)
            case "stop": Task { await recorder.stop() }
            default: throw failure("Unknown capture command.")
            }
        } catch { emit(["type":"error","message":error.localizedDescription]) }
    }
    Task { await recorder.stop() }
}
RunLoop.main.run()
