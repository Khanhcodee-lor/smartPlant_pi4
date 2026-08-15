const express = require('express');
const axios = require('axios');
const router = express.Router();

// Lấy IP từ biến môi trường hoặc mặc định là localhost
const USTREAMER_URL = process.env.USTREAMER_URL || 'http://127.0.0.1:8080';

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

module.exports = router;
