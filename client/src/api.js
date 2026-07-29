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
  return apiFetch('/pests/stats');
}
