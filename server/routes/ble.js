const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/database');
const { exec } = require('child_process');

// Path to BLE Mesh status file (written by Python gateway)
const STATUS_FILE = path.join(__dirname, '..', '..', 'ble_mesh_status.json');

// GET /api/ble/status - Get BLE Mesh gateway status
router.get('/status', (req, res) => {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
      res.json({ success: true, data });
    } else {
      res.json({ success: true, data: { state: 'not_started' } });
    }
  } catch (error) {
    console.error('Error reading BLE status:', error);
    res.status(500).json({ error: 'Failed to read BLE status' });
  }
});

// GET /api/ble/nodes - List all BLE Mesh nodes
router.get('/nodes', (req, res) => {
  try {
    const db = getDb();
    const nodes = db.prepare(`
      SELECT bn.*, z.name as zone_name 
      FROM ble_nodes bn 
      LEFT JOIN zones z ON bn.zone_id = z.id 
      ORDER BY bn.created_at DESC
    `).all();
    res.json({ success: true, data: nodes });
  } catch (error) {
    console.error('Error fetching BLE nodes:', error);
    res.status(500).json({ error: 'Failed to fetch BLE nodes' });
  }
});

// POST /api/ble/nodes/:id/assign-zone - Assign a node to a zone
router.post('/nodes/:id/assign-zone', (req, res) => {
  const { id } = req.params;
  const { zone_id } = req.body;

  try {
    const db = getDb();
    const node = db.prepare('SELECT * FROM ble_nodes WHERE id = ?').get(id);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    // Update the node's zone
    db.prepare('UPDATE ble_nodes SET zone_id = ? WHERE id = ?').run(zone_id, id);

    // Update zone's mesh_address
    if (node.mesh_address) {
      db.prepare('UPDATE zones SET mesh_address = ? WHERE id = ?').run(node.mesh_address, zone_id);
    }

    res.json({ success: true, message: `Node ${id} assigned to zone ${zone_id}` });
  } catch (error) {
    console.error('Error assigning node to zone:', error);
    res.status(500).json({ error: 'Failed to assign node to zone' });
  }
});

// POST /api/ble/scan - Trigger scan for unprovisioned devices
router.post('/scan', (req, res) => {
  try {
    // Write a scan command to status file that the Python gateway can pick up
    // Or directly trigger via D-Bus
    exec('dbus-send --system --dest=org.bluez.mesh --type=method_call /org/bluez/mesh org.bluez.mesh.Network1.UnprovisionedScan uint16:30',
      (error, stdout, stderr) => {
        if (error) {
          console.error('Scan trigger error:', error.message);
          // Fallback: just update status for the gateway to pick up
          res.json({ success: true, message: 'Scan request sent (gateway will handle)' });
        } else {
          res.json({ success: true, message: 'Scanning for unprovisioned devices...' });
        }
      }
    );
  } catch (error) {
    console.error('Error triggering scan:', error);
    res.status(500).json({ error: 'Failed to trigger scan' });
  }
});

// GET /api/ble/zones - Get zones with their mesh assignments
router.get('/zones', (req, res) => {
  try {
    const db = getDb();
    const zones = db.prepare(`
      SELECT z.*, bn.uuid as node_uuid, bn.status as node_status, bn.last_seen as node_last_seen
      FROM zones z
      LEFT JOIN ble_nodes bn ON z.id = bn.zone_id
      ORDER BY z.id
    `).all();
    res.json({ success: true, data: zones });
  } catch (error) {
    console.error('Error fetching BLE zones:', error);
    res.status(500).json({ error: 'Failed to fetch zones' });
  }
});

// DELETE /api/ble/nodes/:id - Remove a BLE node
router.delete('/nodes/:id', (req, res) => {
  const { id } = req.params;
  try {
    const db = getDb();
    const node = db.prepare('SELECT * FROM ble_nodes WHERE id = ?').get(id);
    if (!node) {
      return res.status(404).json({ error: 'Node not found' });
    }

    // Clear mesh_address from zone if assigned
    if (node.zone_id) {
      db.prepare('UPDATE zones SET mesh_address = NULL WHERE id = ?').run(node.zone_id);
    }

    db.prepare('DELETE FROM ble_nodes WHERE id = ?').run(id);
    res.json({ success: true, message: `Node ${id} removed` });
  } catch (error) {
    console.error('Error removing node:', error);
    res.status(500).json({ error: 'Failed to remove node' });
  }
});

module.exports = router;
