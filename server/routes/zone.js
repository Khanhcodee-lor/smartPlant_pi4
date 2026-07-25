const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /api/zones — Danh sách khu vực
router.get('/', (req, res) => {
  try {
    const db = getDb();

    const rows = db.prepare(`
      SELECT z.*,
        (SELECT COUNT(*) FROM sensor_data WHERE zone_id = z.id) as sensor_readings,
        (SELECT COUNT(*) FROM pest_detections WHERE zone_id = z.id) as pest_count,
        (SELECT temperature FROM sensor_data WHERE zone_id = z.id ORDER BY timestamp DESC LIMIT 1) as latest_temp,
        (SELECT humidity FROM sensor_data WHERE zone_id = z.id ORDER BY timestamp DESC LIMIT 1) as latest_humidity,
        (SELECT soil_moisture FROM sensor_data WHERE zone_id = z.id ORDER BY timestamp DESC LIMIT 1) as latest_soil_moisture
      FROM zones z
      ORDER BY z.name
    `).all();

    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/zones/:id — Chi tiết khu vực
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(req.params.id);

    if (!zone) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    // Get recent sensor data for this zone
    const recentSensors = db.prepare(`
      SELECT * FROM sensor_data
      WHERE zone_id = ?
      ORDER BY timestamp DESC
      LIMIT 10
    `).all(req.params.id);

    // Get recent pest detections for this zone
    const recentPests = db.prepare(`
      SELECT * FROM pest_detections
      WHERE zone_id = ?
      ORDER BY timestamp DESC
      LIMIT 5
    `).all(req.params.id);

    res.json({
      data: {
        ...zone,
        recent_sensors: recentSensors,
        recent_pests: recentPests
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/zones — Tạo khu vực mới
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const stmt = db.prepare(`
      INSERT INTO zones (name, description) VALUES (?, ?)
    `);

    const result = stmt.run(name, description || null);

    res.status(201).json({
      message: 'Zone created',
      id: result.lastInsertRowid
    });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Zone name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/zones/:id — Cập nhật khu vực
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { name, description, status } = req.body;

    const existing = db.prepare('SELECT * FROM zones WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    const stmt = db.prepare(`
      UPDATE zones
      SET name = ?, description = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(
      name || existing.name,
      description !== undefined ? description : existing.description,
      status || existing.status,
      req.params.id
    );

    res.json({ message: 'Zone updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
