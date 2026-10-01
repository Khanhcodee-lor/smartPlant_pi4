const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /api/zones — Danh sách khu vực
router.get('/', (req, res) => {
  try {
    const db = getDb();

    const rows = db.prepare(`
      SELECT z.*,
        CASE WHEN bn.id IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM sensor_data WHERE zone_id = z.id) END as sensor_readings,
        (SELECT COUNT(*) FROM pest_detections WHERE zone_id = z.id) as pest_count,
        CASE WHEN bn.id IS NULL THEN NULL ELSE (SELECT temperature FROM sensor_data WHERE zone_id = z.id ORDER BY timestamp DESC LIMIT 1) END as latest_temp,
        CASE WHEN bn.id IS NULL THEN NULL ELSE (SELECT humidity FROM sensor_data WHERE zone_id = z.id ORDER BY timestamp DESC LIMIT 1) END as latest_humidity,
        CASE WHEN bn.id IS NULL THEN NULL ELSE (SELECT soil_moisture FROM sensor_data WHERE zone_id = z.id ORDER BY timestamp DESC LIMIT 1) END as latest_soil_moisture,
        bn.name as node_name,
        bn.mesh_address as node_mesh_address,
        bn.status as node_status,
        bn.last_seen as node_last_seen,
        bn.uuid as node_uuid
      FROM zones z
      INNER JOIN ble_nodes bn ON bn.zone_id = z.id AND bn.status IN ('configured', 'active')
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
  res.status(409).json({ error: 'Khu vực được tạo tự động sau khi node Join Mesh thành công.' });
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
