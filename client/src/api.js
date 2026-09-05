const API_BASE = '/api';

/**
 * Generic fetch wrapper with error handling
 */
async function apiFetch(endpoint) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`[API] ${endpoint}:`, err.message);
    return null;
  }
}

/** Health check — GET /api/health */
export async function fetchHealth() {
  return apiFetch('/health');
}

/** Latest sensor reading — GET /api/sensors/latest */
export async function fetchSensorLatest() {
  const result = await apiFetch('/sensors/latest');
  return result?.data || null;
}

/** Latest sensor for each zone — GET /api/sensors/latest-by-zone */
export async function fetchSensorsByZone() {
  const result = await apiFetch('/sensors/latest-by-zone');
  return result?.data || [];
}

/** Sensor history — GET /api/sensors/history?hours=24 */
export async function fetchSensorHistory(hours = 24, zoneId = null) {
  let url = `/sensors/history?hours=${hours}`;
  if (zoneId) url += `&zone_id=${zoneId}`;
  const result = await apiFetch(url);
  return result?.data || [];
}

/** All zones with stats — GET /api/zones */
export async function fetchZones() {
  const result = await apiFetch('/zones');
  return result?.data || [];
}

/** Zone detail — GET /api/zones/:id */
export async function fetchZoneDetail(id) {
  const result = await apiFetch(`/zones/${id}`);
  return result?.data || null;
}

/** Latest pest detections — GET /api/pests/latest?limit=10 */
export async function fetchPestLatest(limit = 10) {
  const result = await apiFetch(`/pests/latest?limit=${limit}`);
  return result?.data || [];
}

/** Pest statistics — GET /api/pests/stats */
export async function fetchPestStats() {
  const result = await apiFetch('/pests/stats');
  return result || null;
}

/** Clear Pest history — DELETE /api/pests/all */
export async function clearPestHistory() {
  try {
    const res = await fetch(`${API_BASE}/pests/all`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`[API] DELETE /pests/all:`, err.message);
    return null;
  }
}

/** Pest history (all) — GET /api/pests/history?days=30 */
export async function fetchPestHistory(days = 30) {
  const result = await apiFetch(`/pests/history?days=${days}`);
  return result?.data || [];
}

/** Send Chat Message to Mock AI — POST /api/chat */
export async function sendChatMessage(message) {
  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (!res.ok) throw new Error('Chat API Error');
    return await res.json();
  } catch (err) {
    console.error('[API] /chat:', err.message);
    return null;
  }
}

/** Get list of test images from SD card/storage — GET /api/pests/test-images */
export async function fetchTestImages() {
  const result = await apiFetch('/pests/test-images');
  return result?.images || [];
}

/** Upload a test image to storage — POST /api/pests/upload-test */
export async function uploadTestImage(imageBase64, filename) {
  try {
    const res = await fetch(`${API_BASE}/pests/upload-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: imageBase64, filename })
    });
    if (!res.ok) throw new Error('Upload Error');
    return await res.json();
  } catch (err) {
    console.error('[API] /pests/upload-test:', err.message);
    return null;
  }
}

/** Analyze a specific test image on demand — POST /api/pests/analyze */
export async function analyzeImage(filename, imagePath = null) {
  try {
    const res = await fetch(`${API_BASE}/pests/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, image_path: imagePath })
    });
    if (!res.ok) throw new Error('Analyze Error');
    return await res.json();
  } catch (err) {
    console.error('[API] /pests/analyze:', err.message);
    return null;
  }
}

/** Capture a snapshot from Livestream and analyze immediately (server-side) */
export async function captureAndAnalyze() {
  try {
    const res = await fetch(`${API_BASE}/pests/capture-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error('[API] capture-analyze error:', errData);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('[API] captureAndAnalyze:', err.message);
    return null;
  }
}

/** Get current WiFi status — GET /api/wifi/status */
export async function getWifiStatus() {
  const result = await apiFetch('/wifi/status');
  return result;
}

/** Scan for WiFi networks — GET /api/wifi/scan */
export async function scanWifi() {
  const result = await apiFetch('/wifi/scan');
  return result || [];
}

/** Connect to a WiFi network — POST /api/wifi/connect */
export async function connectWifi(ssid, password) {
  try {
    const res = await fetch(`${API_BASE}/wifi/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ssid, password })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to connect');
    }
    return await res.json();
  } catch (err) {
    console.error('[API] connectWifi:', err.message);
    throw err;
  }
}

/** Get BLE Mesh gateway status — GET /api/ble/status */
export async function getBleStatus() {
  const result = await apiFetch('/ble/status');
  return result?.data || { state: 'not_started' };
}

/** Get all BLE Mesh nodes — GET /api/ble/nodes */
export async function getBleNodes() {
  const result = await apiFetch('/ble/nodes');
  return result?.data || [];
}

/** Trigger scan for unprovisioned BLE devices — POST /api/ble/scan */
export async function scanBleDevices() {
  try {
    const res = await fetch(`${API_BASE}/ble/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Scan Error');
    return await res.json();
  } catch (err) {
    console.error('[API] scanBleDevices:', err.message);
    return null;
  }
}

/** Assign a BLE node to a zone — POST /api/ble/nodes/:id/assign-zone */
export async function assignNodeToZone(nodeId, zoneId) {
  try {
    const res = await fetch(`${API_BASE}/ble/nodes/${nodeId}/assign-zone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone_id: zoneId })
    });
    if (!res.ok) throw new Error('Assign Error');
    return await res.json();
  } catch (err) {
    console.error('[API] assignNodeToZone:', err.message);
    return null;
  }
}

/** Remove a BLE node — DELETE /api/ble/nodes/:id */
export async function removeBleNode(nodeId) {
  try {
    const res = await fetch(`${API_BASE}/ble/nodes/${nodeId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete Error');
    return await res.json();
  } catch (err) {
    console.error('[API] removeBleNode:', err.message);
    return null;
  }
}

/** Get zones with BLE mesh assignments — GET /api/ble/zones */
export async function getBleZones() {
  const result = await apiFetch('/ble/zones');
  return result?.data || [];
}
