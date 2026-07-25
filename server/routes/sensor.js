const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /api/sensors/latest — Lấy dữ liệu cảm biến mới nhất
router.get('/latest', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT s.*, z.name as zone_name
      FROM sensor_data s
      LEFT JOIN zones z ON s.zone_id = z.id
      ORDER BY s.timestamp DESC
      LIMIT 1
    `).get();

    if (!row) {
      return res.json({ message: 'No sensor data available', data: null });
    }

    res.json({ data: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sensors/latest-by-zone — Lấy dữ liệu mới nhất cho mỗi zone
router.get('/latest-by-zone', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT s.*, z.name as zone_name
      FROM sensor_data s
      INNER JOIN (
        SELECT zone_id, MAX(timestamp) as max_ts
        FROM sensor_data
        GROUP BY zone_id
      ) latest ON s.zone_id = latest.zone_id AND s.timestamp = latest.max_ts
      LEFT JOIN zones z ON s.zone_id = z.id
      ORDER BY z.name
    `).all();

    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sensors/history?hours=24&zone_id=1 — Lấy lịch sử cảm biến
router.get('/history', (req, res) => {
  try {
    const db = getDb();
    const hours = parseInt(req.query.hours) || 24;
    const zoneId = req.query.zone_id;

    let query = `
      SELECT s.*, z.name as zone_name
      FROM sensor_data s
      LEFT JOIN zones z ON s.zone_id = z.id
      WHERE s.timestamp >= datetime('now', ?)
    `;
    const params = [`-${hours} hours`];

    if (zoneId) {
      query += ' AND s.zone_id = ?';
      params.push(zoneId);
    }

    query += ' ORDER BY s.timestamp ASC';

    const rows = db.prepare(query).all(...params);
    res.json({ data: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sensors — Ghi dữ liệu cảm biến mới
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { temperature, humidity, light, soil_moisture, zone_id } = req.body;

    const stmt = db.prepare(`
      INSERT INTO sensor_data (temperature, humidity, light, soil_moisture, zone_id)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(temperature, humidity, light, soil_moisture, zone_id || null);

    res.status(201).json({
      message: 'Sensor data recorded',
      id: result.lastInsertRowid
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
