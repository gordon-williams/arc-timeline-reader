// PhotoThumb — Get a photo from Apple Photos via PhotoKit (no iCloud download)
//
// Usage: photo-thumb <UUID> <output-path> [--size <pixels>] [--hq]
//
// Default mode: uses .opportunistic delivery with .fast resize — returns whatever
// Apple Photos has cached locally (typically 256–1024px JPEG).
//
// --hq mode: uses .highQualityFormat delivery with .exact resize — triggers full
// RAW/HEIC processing through Core Image. Produces the best possible rendering
// with camera colour profiles, lens corrections, and proper demosaicing.
//
// Exit codes: 0=success, 1=not found, 2=no local image, 3=write failed, 5=bad args

import Foundation
import Photos
import AppKit

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

// Request image — local only, no iCloud download
let options = PHImageRequestOptions()
options.isNetworkAccessAllowed = false
options.isSynchronous = true

if highQuality {
    // Full RAW/HEIC processing through Core Image pipeline
    options.deliveryMode = .highQualityFormat
    options.resizeMode = .exact
} else {
    // Fast mode — return whatever is cached locally
    options.deliveryMode = .opportunistic
    options.resizeMode = .fast
}

let jpegQuality: CGFloat = highQuality ? 0.92 : 0.82

let size = CGSize(width: targetSize, height: targetSize)
var gotImage = false

PHImageManager.default().requestImage(
    for: asset,
    targetSize: size,
    contentMode: .aspectFit,
    options: options
) { image, info in
    guard let image = image else { return }

    // In opportunistic mode we may get called twice (degraded then full) — accept both
    let isDegraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
    _ = isDegraded

    // Convert to JPEG
    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: jpegQuality]) else {
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

exit(gotImage ? 0 : 2)
