const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

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

module.exports = router;
