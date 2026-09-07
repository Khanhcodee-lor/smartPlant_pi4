const express = require('express');
const router = express.Router();
const path = require('path');
const { getDb } = require('../db/database');
const net = require('net');


// GET /api/ble/status - Get BLE Mesh gateway status
router.get('/status', async (req, res) => {
  try {
    const result = await gatewayCommand({ action: 'status' });
    res.json(result);
  } catch (error) {
    res.json({ success: true, data: { state: 'not_started', ready: false, error: error.message } });
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

// Commands must come from the process that owns the BlueZ attachment.
const SOCKET_PATH = process.env.MESH_SOCKET_PATH || path.join(__dirname, '..', '..', 'ble_mesh.sock');
function gatewayCommand(command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH);
    let buffer = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(result);
    };
    socket.setTimeout(5000, () => finish(new Error('Gateway timed out')));
    socket.on('error', () => finish(new Error('BLE gateway unavailable; check Python process and socket permissions')));
    socket.on('connect', () => socket.write(JSON.stringify(command) + '\n'));
    socket.on('data', (data) => {
      buffer += data.toString();
      if (buffer.length > 65536) return finish(new Error('Invalid gateway response'));
      if (!buffer.includes('\n')) return;
      try { finish(null, JSON.parse(buffer.split('\n')[0])); }
      catch { finish(new Error('Invalid gateway response')); }
    });
    socket.on('end', () => finish(new Error('Gateway closed without a response')));
  });
}

for (const action of ['scan', 'provision', 'configure']) {
  router.post(`/${action}`, async (req, res) => {
    const uuid = req.body?.uuid;
    if (action !== 'scan' && (typeof uuid !== 'string' || !/^[0-9a-f]{32}$/i.test(uuid))) {
      return res.status(400).json({ error: 'uuid must contain 32 hexadecimal characters' });
    }
    try {
      const result = await gatewayCommand({ action, uuid });
      res.status(result.success ? 202 : 409).json(result);
    } catch (error) {
      res.status(503).json({ success: false, error: error.message });
    }
  });
}

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
