const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getCapturePreviewUrl } = require('../storagePreview');

test('camera preview prefers a signed annotated image in a private bucket', async () => {
  const paths = [];
  const getServices = () => ({ bucket: { file: path => ({
    getSignedUrl: async options => {
      paths.push(path);
      assert.equal(options.action, 'read');
      return ['https://example.test/signed-annotation'];
    }
  }) } });
  const preview = await getCapturePreviewUrl({
    annotated_image_url: 'detections/annotated.jpg',
    snapshot_url: 'https://example.test/original.jpg'
  }, getServices);
  assert.equal(preview, 'https://example.test/signed-annotation');
  assert.deepEqual(paths, ['detections/annotated.jpg']);
});

test('camera preview falls back to the original when annotation cannot be signed', async () => {
  const getServices = () => ({ bucket: { file: () => ({
    getSignedUrl: async () => { throw new Error('signing unavailable'); }
  }) } });
  const preview = await getCapturePreviewUrl({
    annotated_storage_path: 'detections/annotated.jpg',
    original_image_url: 'https://example.test/original.jpg'
  }, getServices);
  assert.equal(preview, 'https://example.test/original.jpg');
});

test('camera preview keeps a local image path usable', async () => {
  assert.equal(await getCapturePreviewUrl({ image_path: '/latest_detection.jpg' }), '/latest_detection.jpg');
});
