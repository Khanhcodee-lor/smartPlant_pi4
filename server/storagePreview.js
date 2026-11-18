const { getFirebaseServices } = require('./firebase');

// Prefer the annotated photo, but keep the original visible if signing fails.
async function getCapturePreviewUrl(capture, getServices = getFirebaseServices) {
  const candidates = [
    capture.annotated_image_url || capture.annotated_storage_path,
    capture.original_image_url || capture.snapshot_url || capture.snapshotUrl ||
      capture.original_storage_path || capture.image_path
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'string') continue;
    if (/^https?:\/\//i.test(candidate) || candidate.startsWith('/')) return candidate;
    try {
      const { bucket } = getServices();
      const [signedUrl] = await bucket.file(candidate).getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000
      });
      return signedUrl;
    } catch (error) {
      console.warn('[Camera] Không tạo được URL xem ảnh:', error.message);
    }
  }
  return null;
}

module.exports = { getCapturePreviewUrl };
