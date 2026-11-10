const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getFirebaseServices } = require('../firebase');

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeReading(value, metadata = {}) {
  if (!value || typeof value !== 'object') return null;
  const timestamp = toTimestamp(value.timestamp) ||
    toTimestamp(value.updated_at) ||
    toTimestamp(value.created_at);

  return {
    temperature: toNumber(value.temperature),
    humidity: toNumber(value.humidity),
    light: toNumber(value.light),
    soil_moisture: toNumber(value.soil_moisture ?? value.soilMoisture),
    timestamp,
    ...metadata,
  };
}

// GET /api/sensors/firebase?hours=24 — Read node sensor/current + history from RTDB.
router.get('/firebase', async (req, res) => {
  try {
    const { database } = getFirebaseServices();
    const root = await database.ref('/').get();
    const values = root.val() || {};
    const hours = Math.min(168, Math.max(1, Number.parseInt(req.query.hours, 10) || 24));
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const nodes = [];
    const history = [];
    const readingCounts = new Map();

    for (const [nodeKey, nodeValue] of Object.entries(values)) {
      if (!nodeValue || typeof nodeValue !== 'object' || !nodeValue.sensor) continue;

      const sensor = nodeValue.sensor;
      const nodeName = sensor.node_name || nodeKey;
      const zoneName = sensor.zone_name || nodeName;
      const latest = normalizeReading(sensor, {
        node_key: nodeKey,
        node_name: nodeName,
        zone_name: zoneName,
      });

      if (latest) {
        nodes.push({
          id: nodeKey,
          name: zoneName,
          description: nodeName,
          latest_temp: latest.temperature,
          latest_humidity: latest.humidity,
          latest_light: latest.light,
          latest_soil_moisture: latest.soil_moisture,
          updated_at: latest.timestamp,
          sensor_readings: 0,
          latest,
        });
      }

      const nodeHistory = nodeValue.history;
      if (!nodeHistory || typeof nodeHistory !== 'object') continue;
      for (const readingValue of Object.values(nodeHistory)) {
        const reading = normalizeReading(readingValue, {
          node_key: nodeKey,
          node_name: nodeName,
          zone_name: zoneName,
        });
        if (reading?.timestamp && reading.timestamp >= cutoff) {
          history.push(reading);
          readingCounts.set(nodeKey, (readingCounts.get(nodeKey) || 0) + 1);
        }
      }
    }

    history.sort((a, b) => a.timestamp - b.timestamp);
    for (const node of nodes) {
      node.sensor_readings = readingCounts.get(node.id) || 0;
    }
    nodes.sort((a, b) => a.name.localeCompare(b.name));

    const latest = nodes
      .map(node => node.latest)
      .filter(reading => reading?.timestamp)
      .sort((a, b) => b.timestamp - a.timestamp)[0] || null;

    res.set('Cache-Control', 'no-store');
    res.json({ data: { latest, history, nodes } });
  } catch (err) {
    console.error('[Sensors] Firebase Realtime Database read failed:', err.message);
    res.status(503).json({ error: 'Không thể đọc dữ liệu Firebase Realtime Database.' });
  }
});

// GET /api/sensors/latest — Lấy dữ liệu cảm biến mới nhất
router.get('/latest', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT s.*, z.name as zone_name
      FROM sensor_data s
      LEFT JOIN ble_nodes bn ON bn.zone_id = s.zone_id
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
        FROM sensor_data sd
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
      LEFT JOIN ble_nodes bn ON bn.zone_id = s.zone_id
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

    const result = stmt.run(temperature, humidity, light, soil_moisture, zone_id || 1);

    res.status(201).json({
      message: 'Sensor data recorded',
      id: result.lastInsertRowid
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
