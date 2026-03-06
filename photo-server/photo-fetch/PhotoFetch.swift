// PhotoFetch — Download iCloud-evicted media from Apple Photos via PhotoKit
//
// Usage: photo-fetch <UUID> <output-path> [--timeout <seconds>]
//
// Exit codes: 0=success, 1=not found, 2=download failed, 3=unsupported media, 4=permission denied, 5=bad args
//
// Stdout protocol (parsed by server):
//   STATUS:FOUND | DOWNLOADING | COPYING | DONE
//   PROGRESS:0.35
//   ERROR:<message>

import Foundation
import Photos
import AVFoundation
import AppKit

// MARK: - Helpers

func emit(_ line: String) {
    print(line)
    fflush(stdout)
}

func fail(_ message: String, code: Int32) -> Never {
    emit("ERROR:\(message)")
    exit(code)
}

// MARK: - Argument parsing

let args = CommandLine.arguments
guard args.count >= 3 else {
    fail("Usage: photo-fetch <UUID> <output-path> [--timeout <seconds>]", code: 5)
}

let uuid = args[1].uppercased()
let outputPath = args[2]

var timeout: TimeInterval = 300 // 5 minutes default
if let idx = args.firstIndex(of: "--timeout"), idx + 1 < args.count,
   let t = TimeInterval(args[idx + 1]) {
    timeout = t
}

// MARK: - Photos authorization

let authStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)

if authStatus == .notDetermined {
    let sem = DispatchSemaphore(value: 0)
    PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in sem.signal() }
    sem.wait()
}

let finalStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
guard finalStatus == .authorized || finalStatus == .limited else {
    fail("Photos access denied — grant permission in System Settings > Privacy & Security > Photos", code: 4)
}

// MARK: - Fetch asset by UUID

// The Photos database stores ZUUID (e.g. "E1F92593-2A89-44CA-B4F9-5C586A2EEE14").
// PhotoKit's local identifier format is "UUID/L0/001" for the default library.
let localIdentifier = "\(uuid)/L0/001"

let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil)
guard let asset = fetchResult.firstObject else {
    fail("Asset not found for UUID \(uuid)", code: 1)
}

emit("STATUS:FOUND")
let sem = DispatchSemaphore(value: 0)
var exitCode: Int32 = 2

if asset.mediaType == .video {
    // MARK: - Request video from iCloud
    let options = PHVideoRequestOptions()
    options.isNetworkAccessAllowed = true
    options.deliveryMode = .highQualityFormat
    options.progressHandler = { progress, error, stop, info in
        emit("PROGRESS:\(String(format: "%.2f", progress))")
        if let error = error {
            emit("ERROR:Download progress error: \(error.localizedDescription)")
        }
    }

    emit("STATUS:DOWNLOADING")

    PHImageManager.default().requestAVAsset(forVideo: asset, options: options) { avAsset, _, info in
        defer { sem.signal() }

        // Check for errors
        if let error = info?[PHImageErrorKey] as? Error {
            emit("ERROR:\(error.localizedDescription)")
            return
        }

        // Check for cancellation
        if let cancelled = info?[PHImageCancelledKey] as? Bool, cancelled {
            emit("ERROR:Request was cancelled")
            return
        }

        guard let urlAsset = avAsset as? AVURLAsset else {
            // Could be an AVComposition (e.g. slo-mo video) — try export session instead
            if let composition = avAsset {
                emit("STATUS:EXPORTING")
                guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
                    emit("ERROR:Could not create export session for composition")
                    return
                }
                let dstURL = URL(fileURLWithPath: outputPath)
                try? FileManager.default.removeItem(at: dstURL)
                exportSession.outputURL = dstURL
                exportSession.outputFileType = .mov
                let exportSem = DispatchSemaphore(value: 0)
                exportSession.exportAsynchronously {
                    if exportSession.status == .completed {
                        emit("STATUS:DONE")
                        exitCode = 0
                    } else {
                        emit("ERROR:Export failed: \(exportSession.error?.localizedDescription ?? "unknown")")
                    }
                    exportSem.signal()
                }
                exportSem.wait()
                return
            }
            emit("ERROR:Could not get file URL from AVAsset")
            return
        }

        emit("STATUS:COPYING")

        // Copy the temporary file to the output path (temp file deleted after handler returns)
        let srcURL = urlAsset.url
        let dstURL = URL(fileURLWithPath: outputPath)

        do {
            try? FileManager.default.removeItem(at: dstURL)
            try FileManager.default.copyItem(at: srcURL, to: dstURL)

            // Verify the copy succeeded and has content
            let attrs = try FileManager.default.attributesOfItem(atPath: outputPath)
            let size = attrs[.size] as? UInt64 ?? 0
            if size == 0 {
                emit("ERROR:Copied file is empty")
                return
            }

            emit("STATUS:DONE")
            exitCode = 0
        } catch {
            emit("ERROR:Copy failed: \(error.localizedDescription)")
        }
    }
} else if asset.mediaType == .image {
    // MARK: - Request still photo from iCloud
    let options = PHImageRequestOptions()
    options.isNetworkAccessAllowed = true
    options.deliveryMode = .highQualityFormat
    options.version = .current
    options.isSynchronous = false
    options.progressHandler = { progress, error, stop, info in
        emit("PROGRESS:\(String(format: "%.2f", progress))")
        if let error = error {
            emit("ERROR:Download progress error: \(error.localizedDescription)")
        }
    }

    emit("STATUS:DOWNLOADING")

    PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, _, _, info in
        defer { sem.signal() }

        if let error = info?[PHImageErrorKey] as? Error {
            emit("ERROR:\(error.localizedDescription)")
            return
        }
        if let cancelled = info?[PHImageCancelledKey] as? Bool, cancelled {
            emit("ERROR:Request was cancelled")
            return
        }
        guard let data else {
            emit("ERROR:No image data returned")
            return
        }

        emit("STATUS:COPYING")
        let dstURL = URL(fileURLWithPath: outputPath)
        do {
            // Prefer writing JPEG for broad compatibility in browser preview.
            var outData = data
            if let nsImage = NSImage(data: data),
               let tiff = nsImage.tiffRepresentation,
               let rep = NSBitmapImageRep(data: tiff),
               let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.9]) {
                outData = jpeg
            }
            try? FileManager.default.removeItem(at: dstURL)
            try outData.write(to: dstURL, options: .atomic)

            let attrs = try FileManager.default.attributesOfItem(atPath: outputPath)
            let size = attrs[.size] as? UInt64 ?? 0
            if size == 0 {
                emit("ERROR:Saved photo is empty")
                return
            }
            emit("STATUS:DONE")
            exitCode = 0
        } catch {
            emit("ERROR:Write failed: \(error.localizedDescription)")
        }
    }
} else {
    fail("Unsupported media type \(asset.mediaType.rawValue)", code: 3)
}

// Wait with timeout
let waitResult = sem.wait(timeout: .now() + timeout)
if waitResult == .timedOut {
    fail("Timeout after \(Int(timeout)) seconds", code: 2)
}

exit(exitCode)
