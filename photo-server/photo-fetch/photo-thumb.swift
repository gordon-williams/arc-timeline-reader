// PhotoThumb — Render photos via PhotoKit or directly from file via ImageIO
//
// Usage:
//   photo-thumb <UUID> <output-path> [--size <pixels>] [--hq]
//   photo-thumb --path <file-path> <output-path> [--size <pixels>]
//
// UUID mode (default): returns locally cached PhotoKit thumbnail.
// UUID mode (--hq): requests image data from PhotoKit → renders via ImageIO.
// --path mode: renders directly from a file on disk via ImageIO/CGImageSource.
//   Best for RAW files (DNG, CR2, NEF, etc.) — applies camera colour profiles,
//   tone curves, demosaicing, and lens corrections through Apple's ImageIO pipeline.
//
// Exit codes: 0=success, 1=not found, 2=no local image, 3=write failed, 5=bad args

import Foundation
import Photos
import AppKit
import ImageIO

// MARK: - Argument parsing

let args = CommandLine.arguments

let pathMode = args.contains("--path")
let highQuality = args.contains("--hq")

var targetSize = 3200
if let idx = args.firstIndex(of: "--size"), idx + 1 < args.count,
   let s = Int(args[idx + 1]) {
    targetSize = s
}

// MARK: - ImageIO rendering (shared by both modes)

func renderWithImageIO(data: Data, outputPath: String, maxSize: Int, quality: Double = 0.92) -> Bool {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
        fputs("ERROR: CGImageSourceCreateWithData failed\n", stderr)
        return false
    }

    // Get source image properties for diagnostics
    if let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] {
        let w = props[kCGImagePropertyPixelWidth] ?? "?"
        let h = props[kCGImagePropertyPixelHeight] ?? "?"
        let profile = props[kCGImagePropertyProfileName] ?? "none"
        fputs("INFO: source=\(w)×\(h), profile=\(profile)\n", stderr)
    }

    let thumbOptions: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceThumbnailMaxPixelSize: maxSize,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceShouldCacheImmediately: true
    ]

    guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions as CFDictionary) else {
        fputs("ERROR: CGImageSourceCreateThumbnailAtIndex failed\n", stderr)
        return false
    }

    fputs("INFO: rendered \(cgImage.width)×\(cgImage.height)\n", stderr)

    // Convert CGImage to JPEG preserving colour profile
    let rep = NSBitmapImageRep(cgImage: cgImage)
    guard let jpeg = rep.representation(using: .jpeg, properties: [
        .compressionFactor: NSNumber(value: quality)
    ]) else {
        fputs("ERROR: JPEG conversion failed\n", stderr)
        return false
    }

    let dstURL = URL(fileURLWithPath: outputPath)
    do {
        try? FileManager.default.removeItem(at: dstURL)
        try jpeg.write(to: dstURL, options: .atomic)
        return true
    } catch {
        fputs("ERROR: Write failed: \(error.localizedDescription)\n", stderr)
        return false
    }
}

// MARK: - Path mode: render directly from file

if pathMode {
    guard let pathIdx = args.firstIndex(of: "--path"), pathIdx + 2 < args.count else {
        fputs("Usage: photo-thumb --path <file-path> <output-path> [--size <pixels>]\n", stderr)
        exit(5)
    }
    let filePath = args[pathIdx + 1]
    let outputPath = args[pathIdx + 2]

    guard FileManager.default.fileExists(atPath: filePath) else {
        fputs("ERROR: File not found: \(filePath)\n", stderr)
        exit(1)
    }

    // Read the file and render through ImageIO
    guard let data = FileManager.default.contents(atPath: filePath) else {
        fputs("ERROR: Could not read file\n", stderr)
        exit(2)
    }

    // Report the UTI
    if let source = CGImageSourceCreateWithData(data as CFData, nil),
       let uti = CGImageSourceGetType(source) {
        fputs("INFO: UTI=\(uti)\n", stderr)
    }

    fputs("INFO: dataSize=\(data.count)\n", stderr)
    exit(renderWithImageIO(data: data, outputPath: outputPath, maxSize: targetSize) ? 0 : 2)
}

// MARK: - UUID mode

guard args.count >= 3 else {
    fputs("Usage: photo-thumb <UUID> <output-path> [--size <pixels>] [--hq]\n", stderr)
    exit(5)
}

let uuid = args[1].uppercased()
let outputPath = args[2]

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
    let options = PHImageRequestOptions()
    options.isNetworkAccessAllowed = false
    options.deliveryMode = .highQualityFormat
    options.version = .current
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

        gotImage = renderWithImageIO(data: data, outputPath: outputPath, maxSize: targetSize)
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
