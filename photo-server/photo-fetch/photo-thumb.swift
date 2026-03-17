// PhotoThumb — Get a photo from Apple Photos via PhotoKit (no iCloud download)
//
// Usage: photo-thumb <UUID> <output-path> [--size <pixels>] [--hq]
//
// Default mode: uses .opportunistic delivery with .fast resize — returns whatever
// Apple Photos has cached locally (typically 256–1024px JPEG).
//
// --hq mode: requests full image data via PhotoKit, then renders through
// CGImageSource (ImageIO) which applies proper RAW colour profiles, tone curves,
// camera-specific processing, and lens corrections — the same pipeline Preview.app uses.
//
// Exit codes: 0=success, 1=not found, 2=no local image, 3=write failed, 5=bad args

import Foundation
import Photos
import AppKit
import ImageIO

let args = CommandLine.arguments
guard args.count >= 3 else {
    fputs("Usage: photo-thumb <UUID> <output-path> [--size <pixels>] [--hq]\n", stderr)
    exit(5)
}

let uuid = args[1].uppercased()
let outputPath = args[2]

var targetSize = 512
if let idx = args.firstIndex(of: "--size"), idx + 1 < args.count,
   let s = Int(args[idx + 1]) {
    targetSize = s
}

let highQuality = args.contains("--hq")

// Photos authorization
let authStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
if authStatus == .notDetermined {
    let sem = DispatchSemaphore(value: 0)
    PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in sem.signal() }
    sem.wait()
}
let finalStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
guard finalStatus == .authorized || finalStatus == .limited else {
    fputs("ERROR: Photos access denied\n", stderr)
    exit(4)
}

// Fetch asset by UUID
let localIdentifier = "\(uuid)/L0/001"
let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: [localIdentifier], options: nil)
guard let asset = fetchResult.firstObject else {
    exit(1) // not found — silent, caller handles
}

var gotImage = false

if highQuality {
    // ─── HQ mode: request image data → render through ImageIO ───
    // This produces the same quality as Preview.app for RAW files,
    // with proper colour profiles, tone curves, and demosaicing.

    let options = PHImageRequestOptions()
    options.isNetworkAccessAllowed = false
    options.deliveryMode = .highQualityFormat
    options.version = .current  // include user edits
    options.isSynchronous = false

    var finished = false

    PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, uti, _, info in
        defer { finished = true }

        if let error = info?[PHImageErrorKey] as? Error {
            fputs("ERROR: \(error.localizedDescription)\n", stderr)
            return
        }
        guard let data = data else {
            fputs("ERROR: No image data returned\n", stderr)
            return
        }

        let utiStr = uti ?? "unknown"
        fputs("INFO: UTI=\(utiStr), dataSize=\(data.count)\n", stderr)

        // Use CGImageSource to render — this goes through ImageIO which has
        // full RAW support with camera profiles, tone curves, lens corrections
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
            fputs("ERROR: CGImageSourceCreateWithData failed\n", stderr)
            return
        }

        let thumbOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: targetSize,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true
        ]

        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions as CFDictionary) else {
            fputs("ERROR: CGImageSourceCreateThumbnailAtIndex failed\n", stderr)
            return
        }

        fputs("INFO: rendered \(cgImage.width)×\(cgImage.height)\n", stderr)

        // Convert CGImage to JPEG with colour profile preserved
        let rep = NSBitmapImageRep(cgImage: cgImage)
        guard let jpeg = rep.representation(using: .jpeg, properties: [
            .compressionFactor: NSNumber(value: 0.92)
        ]) else {
            fputs("ERROR: JPEG conversion failed\n", stderr)
            return
        }

        let dstURL = URL(fileURLWithPath: outputPath)
        do {
            try? FileManager.default.removeItem(at: dstURL)
            try jpeg.write(to: dstURL, options: .atomic)
            gotImage = true
        } catch {
            fputs("ERROR: Write failed: \(error.localizedDescription)\n", stderr)
        }
    }

    // RunLoop wait (required for async PhotoKit callbacks)
    let deadline = Date(timeIntervalSinceNow: 30)
    while !finished && Date() < deadline {
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.1))
    }
} else {
    // ─── Fast mode: return whatever PhotoKit has cached locally ───
    let options = PHImageRequestOptions()
    options.isNetworkAccessAllowed = false
    options.deliveryMode = .opportunistic
    options.isSynchronous = true
    options.resizeMode = .fast

    let size = CGSize(width: targetSize, height: targetSize)

    PHImageManager.default().requestImage(
        for: asset,
        targetSize: size,
        contentMode: .aspectFit,
        options: options
    ) { image, info in
        guard let image = image else { return }

        let isDegraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
        _ = isDegraded

        guard let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82]) else {
            return
        }

        let dstURL = URL(fileURLWithPath: outputPath)
        do {
            try? FileManager.default.removeItem(at: dstURL)
            try jpeg.write(to: dstURL, options: .atomic)
            gotImage = true
        } catch {
            fputs("ERROR: Write failed: \(error.localizedDescription)\n", stderr)
        }
    }
}

exit(gotImage ? 0 : 2)
