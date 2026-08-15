const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/database');

function getTestImagesDir() {
  const candidates = [
    path.join(__dirname, '../../ai_engine/test_images'),
    path.join(__dirname, '../ai_engine/test_images'),
    path.join(process.cwd(), 'ai_engine/test_images'),
    path.join(process.cwd(), '../ai_engine/test_images'),
    '/home/toan/Smart_Plant/ai_engine/test_images',
    '/home/khanh/Workspace_company/pi_4/Smart_Plant/ai_engine/test_images'
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  const fallback = path.join(__dirname, '../../ai_engine/test_images');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

// GET /api/pests/test-images — Danh sách ảnh test trong thẻ nhớ
router.get('/test-images', (req, res) => {
  try {
    const dir = getTestImagesDir();
    const files = fs.readdirSync(dir).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.bmp'].includes(ext);
    });

    res.json({
      directory: dir,
      images: files.map(filename => ({
        filename,
        url: `/api/pests/test-image/${encodeURIComponent(filename)}`
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pests/test-image/:filename — Xem trực tiếp ảnh test
router.get('/test-image/:filename', (req, res) => {
  try {
    const dir = getTestImagesDir();
    const filePath = path.join(dir, req.params.filename);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pests/upload-test — Tải thêm ảnh test vào thẻ nhớ
router.post('/upload-test', (req, res) => {
  try {
    const { image_base64, filename } = req.body;
    if (!image_base64) {
      return res.status(400).json({ error: 'image_base64 is required' });
    }

    const dir = getTestImagesDir();
    const safeName = (filename || `test_${Date.now()}.jpg`).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = path.join(dir, safeName);

    // Remove base64 header if exists
    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    res.json({
      message: 'Upload test image successful',
      filename: safeName,
      url: `/api/pests/test-image/${encodeURIComponent(safeName)}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const { execFile } = require('child_process');

function getEngineBinaryPath() {
  const candidates = [
    '/home/toan/Smart_Plant/ai_engine/smart_plant_engine',
    path.join(__dirname, '../../ai_engine/smart_plant_engine'),
    path.join(__dirname, '../../ai_engine/build_pi/smart_plant_engine'),
    path.join(process.cwd(), 'ai_engine/smart_plant_engine'),
    path.join(process.cwd(), '../ai_engine/smart_plant_engine')
  ];
  for (const b of candidates) {
    if (fs.existsSync(b)) return b;
  }
  return candidates[0];
}

// POST /api/pests/analyze — Kích hoạt AI phân tích 1 ảnh cụ thể ngay lập tức
router.post('/analyze', (req, res) => {
  try {
    const { filename, image_path } = req.body;
    let targetPath = image_path;
    
    if (!targetPath && filename) {
      targetPath = path.join(getTestImagesDir(), filename);
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(400).json({ error: 'File ảnh không tồn tại: ' + targetPath });
    }

    const binary = getEngineBinaryPath();
    if (!fs.existsSync(binary)) {
      return res.status(500).json({ error: 'Không tìm thấy binary smart_plant_engine: ' + binary });
    }

    execFile(binary, ['--analyze', targetPath], { timeout: 120000, maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[AI Analyze Error]:', error, stderr);
        return res.status(500).json({ error: error.message, stderr });
      }

      try {
        // Tìm dòng JSON cuối cùng trong stdout
        const lines = stdout.trim().split('\n');
        let jsonStr = '';
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].trim().startsWith('{')) {
            jsonStr = lines[i].trim();
            break;
          }
        }

        if (!jsonStr) {
          return res.status(500).json({ error: 'Không đọc được kết quả JSON từ AI engine', stdout });
        }

        const result = JSON.parse(jsonStr);

        // Lưu bản ghi vào database nếu có phát hiện bệnh
        if (result.pest_type && result.pest_type !== 'Cây khỏe mạnh (Healthy)') {
          const db = getDb();
          const stmt = db.prepare(`
            INSERT INTO pest_detections (pest_type, confidence, image_path, zone_id, severity, notes)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          stmt.run(
            result.pest_type,
            result.confidence || 0.9,
            result.image_path || '/latest_detection.jpg',
            result.zone_id || 1,
            result.severity || 'medium',
            result.notes || 'Phân tích từ ảnh chọn trong thẻ nhớ'
          );
        }

        res.json({
          success: true,
          data: result
        });
      } catch (parseErr) {
        res.status(500).json({ error: 'Lỗi parse JSON: ' + parseErr.message, stdout });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET /api/pests/latest — Lấy phát hiện sâu bệnh mới nhất
router.get('/latest', (req, res) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit) || 10;

    const rows = db.prepare(`
      SELECT p.*, z.name as zone_name
      FROM pest_detections p
      LEFT JOIN zones z ON p.zone_id = z.id
      ORDER BY p.timestamp DESC
      LIMIT ?
    `).all(limit);

    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pests/history?days=7 — Lịch sử phát hiện sâu bệnh
router.get('/history', (req, res) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days) || 7;

    const rows = db.prepare(`
      SELECT p.*, z.name as zone_name
      FROM pest_detections p
      LEFT JOIN zones z ON p.zone_id = z.id
      WHERE p.timestamp >= datetime('now', ?)
      ORDER BY p.timestamp DESC
    `).all(`-${days} days`);

    res.json({ data: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pests/stats — Thống kê sâu bệnh theo loại
router.get('/stats', (req, res) => {
  try {
    const db = getDb();

    const byType = db.prepare(`
      SELECT pest_type, COUNT(*) as count, AVG(confidence) as avg_confidence,
             MAX(timestamp) as last_detected
      FROM pest_detections
      GROUP BY pest_type
      ORDER BY count DESC
    `).all();

    const bySeverity = db.prepare(`
      SELECT severity, COUNT(*) as count
      FROM pest_detections
      GROUP BY severity
      ORDER BY 
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END
    `).all();

    const total = db.prepare('SELECT COUNT(*) as total FROM pest_detections').get();

    res.json({
      total: total.total,
      by_type: byType,
      by_severity: bySeverity
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pests — Ghi kết quả phát hiện sâu bệnh mới (từ AI engine)
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { pest_type, confidence, image_path, zone_id, severity, notes } = req.body;

    if (!pest_type || confidence === undefined) {
      return res.status(400).json({ error: 'pest_type and confidence are required' });
    }

    const stmt = db.prepare(`
      INSERT INTO pest_detections (pest_type, confidence, image_path, zone_id, severity, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      pest_type,
      confidence,
      image_path || null,
      zone_id || null,
      severity || 'low',
      notes || null
    );

    res.status(201).json({
      message: 'Pest detection recorded',
      id: result.lastInsertRowid
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pests/all — Xóa toàn bộ lịch sử phát hiện sâu bệnh
router.delete('/all', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM pest_detections').run();
    res.json({ success: true, message: 'Đã xóa toàn bộ lịch sử phát hiện', changes: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
