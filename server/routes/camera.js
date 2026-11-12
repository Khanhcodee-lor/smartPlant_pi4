const express = require('express');
const axios = require('axios');
const { execFile } = require('child_process');
const { randomUUID } = require('crypto');
const { getFirebaseServices } = require('../firebase');
const router = express.Router();

function execV4l2(args) {
  return new Promise((resolve, reject) => {
    execFile('v4l2-ctl', args, { timeout: 3000 }, (error, stdout) => {
      if (error) return reject(error);
      resolve(stdout);
    });
  });
}

// Lấy IP từ biến môi trường hoặc mặc định là localhost
const USTREAMER_URL = process.env.USTREAMER_URL || 'http://127.0.0.1:8080';
const DEFAULT_PLANT_ID = process.env.PLANT_ID || 'tomato_001';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

function getCaptureCommandRef(database, plantId = DEFAULT_PLANT_ID) {
  return database.ref(`plants/${plantId}/commands/capture`);
}

function getCaptureRef(database, requestId, plantId = DEFAULT_PLANT_ID) {
  return database.ref(`plants/${plantId}/plant_captures/${requestId}`);
}

function getCaptureDatabase() {
  const { database } = getFirebaseServices();
  if (!database) {
    throw new Error('FIREBASE_DATABASE_URL is required for Raspberry Pi camera capture.');
  }
  return database;
}

/**
 * Proxy luồng Livestream MJPEG từ ustreamer
 * Giúp Frontend (React) không cần gọi trực tiếp port 8080 (tránh lỗi CORS / cấu hình phức tạp)
 */
router.get('/stream', (req, res) => {
  // Yêu cầu ustreamer trả về luồng stream
  axios({
    method: 'get',
    url: `${USTREAMER_URL}/stream`,
    responseType: 'stream'
  }).then(response => {
    // Copy headers (Content-Type: multipart/x-mixed-replace)
    res.set(response.headers);
    // Pipe data từ ustreamer thẳng về browser của người dùng
    response.data.pipe(res);
  }).catch(err => {
    console.error('[Camera] Lỗi proxy stream:', err.message);
    res.status(502).send('Camera stream offline. Hãy đảm bảo ustreamer đang chạy ở port 8080.');
  });
});

/**
 * Lấy 1 ảnh Snapshot tức thì từ ustreamer (rất nhanh)
 */
router.get('/snapshot', async (req, res) => {
  try {
    const response = await axios.get(`${USTREAMER_URL}/snapshot`, { responseType: 'arraybuffer' });
    res.set('Content-Type', 'image/jpeg');
    res.send(response.data);
  } catch (err) {
    console.error('[Camera] Lỗi lấy snapshot:', err.message);
    res.status(502).json({ error: 'Không thể lấy ảnh từ camera' });
  }
});

/**
 * GET /api/camera/controls — Lấy thông số phần cứng của camera (sharpness, brightness, contrast...)
 */
router.get('/controls', async (req, res) => {
  const device = process.env.CAMERA_DEVICE || '/dev/video0';
  try {
    const stdout = await execV4l2(['-d', device, '--get-ctrl=sharpness,brightness,contrast,saturation']);
    const controls = {};
    for (const line of stdout.split('\n')) {
      const parts = line.split(':');
      if (parts.length === 2) {
        const key = parts[0].trim();
        const val = parseInt(parts[1].trim(), 10);
        if (!isNaN(val)) controls[key] = val;
      }
    }
    res.json({ success: true, controls });
  } catch (err) {
    console.error('[Camera] Lỗi đọc controls:', err.message);
    res.status(500).json({ success: false, error: 'Không đọc được thông số camera.' });
  }
});

/**
 * POST /api/camera/controls — Cập nhật thông số phần cứng camera (sharpness, v.v.)
 */
router.post('/controls', async (req, res) => {
  const device = process.env.CAMERA_DEVICE || '/dev/video0';
  const { sharpness, brightness, contrast, saturation } = req.body || {};
  const updates = [];

  if (sharpness !== undefined && !isNaN(Number(sharpness))) {
    const val = Math.max(0, Math.min(255, Math.round(Number(sharpness))));
    updates.push(`sharpness=${val}`);
  }
  if (brightness !== undefined && !isNaN(Number(brightness))) {
    const val = Math.max(0, Math.min(255, Math.round(Number(brightness))));
    updates.push(`brightness=${val}`);
  }
  if (contrast !== undefined && !isNaN(Number(contrast))) {
    const val = Math.max(0, Math.min(255, Math.round(Number(contrast))));
    updates.push(`contrast=${val}`);
  }
  if (saturation !== undefined && !isNaN(Number(saturation))) {
    const val = Math.max(0, Math.min(255, Math.round(Number(saturation))));
    updates.push(`saturation=${val}`);
  }

  if (updates.length === 0) {
    return res.status(400).json({ success: false, error: 'Không có thông số hợp lệ để cập nhật.' });
  }

  try {
    const args = ['-d', device, '-c', updates.join(',')];
    await execV4l2(args);
    res.json({ success: true, updated: updates });
  } catch (err) {
    console.error('[Camera] Lỗi cài đặt controls:', err.message);
    res.status(500).json({ success: false, error: 'Không cài đặt được thông số camera.' });
  }
});

// POST /api/camera/capture — queue a capture for the Raspberry Pi camera service.
router.post('/capture', async (req, res) => {
  try {
    const database = getCaptureDatabase();
    const requestId = `mobile_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const command = {
      status: 1,
      request_id: requestId,
      timestamp: Date.now() / 1000
    };
    const result = await getCaptureCommandRef(database).transaction(current => {
      if (current && [1, 2].includes(Number(current.status))) return;
      return command;
    });

    if (!result.committed) {
      const current = result.snapshot.val();
      return res.status(409).json({
        success: false,
        error: 'Camera Pi đang xử lý một lệnh chụp khác.',
        active_request_id: current?.request_id || null,
        status: current?.status ?? null
      });
    }

    return res.status(202).json({ success: true, request_id: requestId, status: 'queued' });
  } catch (err) {
    console.error('[Camera] Không gửi được lệnh chụp tới Pi:', err.message);
    return res.status(503).json({ success: false, error: err.message });
  }
});

// GET /api/camera/capture/:requestId — poll the Pi service until capture finishes.
router.get('/capture/:requestId', async (req, res) => {
  const { requestId } = req.params;
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    return res.status(400).json({ success: false, error: 'request_id không hợp lệ.' });
  }

  try {
    const database = getCaptureDatabase();
    const [commandSnapshot, captureSnapshot] = await Promise.all([
      getCaptureCommandRef(database).get(),
      getCaptureRef(database, requestId).get()
    ]);
    const command = commandSnapshot.val();
    const capture = captureSnapshot.val();

    if (capture && capture.status === 'completed') {
      let imageUrl = capture.snapshot_url || capture.snapshotUrl || null;
      if ((!imageUrl || !/^https?:\/\//i.test(imageUrl)) && capture.image_path) {
        try {
          const { bucket } = getFirebaseServices();
          const [signedUrl] = await bucket.file(capture.image_path).getSignedUrl({
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000
          });
          imageUrl = signedUrl;
        } catch (urlError) {
          console.warn('[Camera] Không tạo được URL xem ảnh:', urlError.message);
        }
      }

      return res.json({
        success: true,
        request_id: requestId,
        status: 'completed',
        capture: { ...capture, preview_url: imageUrl }
      });
    }

    if (command?.request_id === requestId && Number(command.status) === -1) {
      return res.json({
        success: true,
        request_id: requestId,
        status: 'failed',
        error: command.error || 'Pi không chụp được ảnh.'
      });
    }

    if (command?.request_id === requestId) {
      return res.json({
        success: true,
        request_id: requestId,
        status: Number(command.status) === 2 ? 'processing' : 'queued'
      });
    }

    return res.status(404).json({
      success: false,
      request_id: requestId,
      error: 'Không tìm thấy yêu cầu chụp ảnh.'
    });
  } catch (err) {
    console.error('[Camera] Không đọc được trạng thái chụp:', err.message);
    return res.status(503).json({ success: false, error: err.message });
  }
});

module.exports = router;
