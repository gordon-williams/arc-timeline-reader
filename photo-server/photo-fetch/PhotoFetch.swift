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
import ImageIO
import CoreImage

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
// PhotoKit's local identifier is usually "UUID/L0/001", but assets from shared
// albums / Shared with You can carry a different suffix and are excluded from
// default fetches — so try both identifier forms and include all source types.
func fetchAssetByUUID(_ uuid: String) -> PHAsset? {
    let opts = PHFetchOptions()
    opts.includeAssetSourceTypes = [.typeUserLibrary, .typeCloudShared, .typeiTunesSynced]
    for identifier in ["\(uuid)/L0/001", uuid] {
        let result = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: opts)
        if let asset = result.firstObject { return asset }
    }
    return nil
}

guard let asset = fetchAssetByUUID(uuid) else {
    fail("Asset not found for UUID \(uuid)", code: 1)
}

emit("STATUS:FOUND")

// Shared state for RunLoop-based waiting
var finished = false
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
        // Check for errors
        if let error = info?[PHImageErrorKey] as? Error {
            emit("ERROR:\(error.localizedDescription)")
            finished = true
            return
        }

        // Check for cancellation
        if let cancelled = info?[PHImageCancelledKey] as? Bool, cancelled {
            emit("ERROR:Request was cancelled")
            finished = true
            return
        }

        guard let urlAsset = avAsset as? AVURLAsset else {
            // Could be an AVComposition (e.g. slo-mo video) — try export session instead
            if let composition = avAsset {
                emit("STATUS:EXPORTING")
                guard let exportSession = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
                    emit("ERROR:Could not create export session for composition")
                    finished = true
                    return
                }
                let dstURL = URL(fileURLWithPath: outputPath)
                try? FileManager.default.removeItem(at: dstURL)
                exportSession.outputURL = dstURL
                exportSession.outputFileType = .mov
                exportSession.exportAsynchronously {
                    if exportSession.status == .completed {
                        emit("STATUS:DONE")
                        exitCode = 0
                    } else {
                        emit("ERROR:Export failed: \(exportSession.error?.localizedDescription ?? "unknown")")
                    }
                    finished = true
                }
                return
            }
            emit("ERROR:Could not get file URL from AVAsset")
            finished = true
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
                finished = true
                return
            }

            emit("STATUS:DONE")
            exitCode = 0
        } catch {
            emit("ERROR:Copy failed: \(error.localizedDescription)")
        }
        finished = true
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
        if let error = info?[PHImageErrorKey] as? Error {
            emit("ERROR:\(error.localizedDescription)")
            finished = true
            return
        }
        if let cancelled = info?[PHImageCancelledKey] as? Bool, cancelled {
            emit("ERROR:Request was cancelled")
            finished = true
            return
        }
        guard let data else {
            emit("ERROR:No image data returned")
            finished = true
            return
        }

        emit("STATUS:COPYING")
        let dstURL = URL(fileURLWithPath: outputPath)
        do {
            var outData = data
            if let source = CGImageSourceCreateWithData(data as CFData, nil) {
                let uti = CGImageSourceGetType(source) as String? ?? "unknown"
                emit("INFO:UTI=\(uti), dataSize=\(data.count)")

                let rawUTIs: Set<String> = [
                    "com.adobe.raw-image", "com.canon.cr2-raw-image", "com.canon.cr3-raw-image",
                    "com.nikon.raw-image", "com.sony.raw-image", "com.fuji.raw-image",
                    "com.olympus.raw-image", "com.panasonic.raw-image", "com.pentax.raw-image",
                    "com.samsung.raw-image", "com.leica.raw-image", "com.hasselblad.fff-raw-image",
                    "com.leafamerica.raw-image", "com.konicaminolta.raw-image",
                    "com.sigma.x3f-raw-image", "com.phaseone.raw-image",
                ]
                let isRAW = rawUTIs.contains(uti) || uti.contains("raw")

                if isRAW {
                    // Use CIRAWFilter for proper tone curves + camera colour profiles
                    emit("INFO:RAW data — using CIRAWFilter")
                    let tempDir = FileManager.default.temporaryDirectory
                    let tempFile = tempDir.appendingPathComponent("photo-fetch-raw-\(ProcessInfo.processInfo.processIdentifier).dng")
                    try data.write(to: tempFile, options: .atomic)
                    defer { try? FileManager.default.removeItem(at: tempFile) }

                    if let rawFilter = CIFilter(imageURL: tempFile, options: [:]),
                       let ciImage = rawFilter.outputImage {
                        // Scale to max 4096px
                        let maxDim = max(ciImage.extent.width, ciImage.extent.height)
                        var finalImage = ciImage
                        if maxDim > 4096 {
                            let scale = 4096.0 / maxDim
                            finalImage = ciImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                        }
                        let ctx = CIContext(options: [
                            .workingColorSpace: CGColorSpace(name: CGColorSpace.displayP3)!,
                            .outputColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!
                        ])
                        if let cgImage = ctx.createCGImage(finalImage, from: finalImage.extent) {
                            let rep = NSBitmapImageRep(cgImage: cgImage)
                            if let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.92]) {
                                outData = jpeg
                                emit("INFO:rendered \(cgImage.width)×\(cgImage.height) via CIRAWFilter")
                            }
                        }
                    }
                } else {
                    // Non-RAW: render through ImageIO
                    let opts: [CFString: Any] = [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceThumbnailMaxPixelSize: 4096,
                        kCGImageSourceCreateThumbnailWithTransform: true,
                        kCGImageSourceShouldCacheImmediately: true
                    ]
                    if let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, opts as CFDictionary) {
                        let rep = NSBitmapImageRep(cgImage: cgImage)
                        if let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.92]) {
                            outData = jpeg
                            emit("INFO:rendered \(cgImage.width)×\(cgImage.height)")
                        }
                    }
                }
            }
            try? FileManager.default.removeItem(at: dstURL)
            try outData.write(to: dstURL, options: .atomic)

            let attrs = try FileManager.default.attributesOfItem(atPath: outputPath)
            let size = attrs[.size] as? UInt64 ?? 0
            if size == 0 {
                emit("ERROR:Saved photo is empty")
                finished = true
                return
            }
            emit("STATUS:DONE")
            exitCode = 0
        } catch {
            emit("ERROR:Write failed: \(error.localizedDescription)")
        }
        finished = true
    }
} else {
    fail("Unsupported media type \(asset.mediaType.rawValue)", code: 3)
}

// MARK: - RunLoop-based wait (required for iCloud network operations)
// PhotoKit iCloud downloads need the RunLoop to process network events.
// Using sem.wait() blocks the main thread and prevents downloads from starting.
let deadline = Date(timeIntervalSinceNow: timeout)
while !finished && Date() < deadline {
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.25))
}

if !finished {
    fail("Timeout after \(Int(timeout)) seconds", code: 2)
}

exit(exitCode)
