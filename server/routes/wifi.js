const express = require('express');
const router = express.Router();
const wifi = require('node-wifi');

// Initialize wifi module
// Using 'wpa_supplicant' or 'nmcli' depending on the Pi OS. node-wifi usually auto-detects.
wifi.init({
  iface: null // network interface, choose a random empty string to allow auto-detection
});

// GET /api/wifi/scan - Scan for available WiFi networks
router.get('/scan', async (req, res) => {
  try {
    const networks = await wifi.scan();
    
    // Sort networks by signal strength and remove duplicates by SSID
    const uniqueNetworks = [];
    const ssids = new Set();
    
    // Sort by signal level (descending - usually signal is negative, closer to 0 is better, but node-wifi might normalize)
    // Actually, node-wifi returns signal_level (e.g. -60)
    networks.sort((a, b) => b.signal_level - a.signal_level).forEach(net => {
      if (net.ssid && !ssids.has(net.ssid)) {
        ssids.add(net.ssid);
        uniqueNetworks.push(net);
      }
    });

    res.json(uniqueNetworks);
  } catch (error) {
    console.error('Error scanning wifi:', error);
    res.status(500).json({ error: 'Failed to scan WiFi networks', details: error.message });
  }
});

// GET /api/wifi/status - Get current WiFi connection status
router.get('/status', async (req, res) => {
  try {
    const currentConnections = await wifi.getCurrentConnections();
    if (currentConnections && currentConnections.length > 0) {
      res.json(currentConnections[0]);
    } else {
      res.json({ status: 'disconnected', ssid: null });
    }
  } catch (error) {
    console.error('Error getting wifi status:', error);
    res.status(500).json({ error: 'Failed to get WiFi status', details: error.message });
  }
});

// POST /api/wifi/connect - Connect to a WiFi network
router.post('/connect', async (req, res) => {
  const { ssid, password } = req.body;

  if (!ssid) {
    return res.status(400).json({ error: 'SSID is required' });
  }

  try {
    await wifi.connect({ ssid, password });
    res.json({ success: true, message: `Connected to ${ssid} successfully` });
  } catch (error) {
    console.error(`Error connecting to wifi ${ssid}:`, error);
    res.status(500).json({ error: `Failed to connect to ${ssid}`, details: error.message });
  }
});

module.exports = router;
