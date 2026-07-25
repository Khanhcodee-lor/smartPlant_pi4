/**
 * Smart Plant Dashboard — Frontend Logic
 * Auto-refreshes data, renders charts and pest alerts
 */

// ==================== CONFIG ====================
const API_BASE = '';
const REFRESH_INTERVAL = 30000; // 30 seconds
let currentHours = 6;
let chartTempHumidity = null;
let chartLightSoil = null;

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  loadAllData();
  setupChartControls();
  setInterval(loadAllData, REFRESH_INTERVAL);
  document.getElementById('footer-year').textContent = new Date().getFullYear();
});

// ==================== CLOCK ====================
function startClock() {
  const clockEl = document.getElementById('clock');
  function update() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
  update();
  setInterval(update, 1000);
}

// ==================== DATA LOADING ====================
async function loadAllData() {
  try {
    await Promise.all([
      loadLatestSensors(),
      loadSensorHistory(currentHours),
      loadPestDetections(),
      loadZones()
    ]);
    updateConnectionStatus(true);
    updateLastRefreshed();
  } catch (err) {
    console.error('Failed to load data:', err);
    updateConnectionStatus(false);
  }
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connection-status');
  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('.status-text');

  if (connected) {
    dot.className = 'status-dot connected';
    text.textContent = 'Đã kết nối';
  } else {
    dot.className = 'status-dot error';
    text.textContent = 'Mất kết nối';
  }
}

function updateLastRefreshed() {
  const el = document.getElementById('last-updated');
  const now = new Date();
  el.textContent = `Cập nhật: ${now.toLocaleTimeString('vi-VN')}`;
}

// ==================== SENSOR CARDS ====================
async function loadLatestSensors() {
  const res = await fetch(`${API_BASE}/api/sensors/latest`);
  const json = await res.json();

  if (!json.data) return;

  const d = json.data;
  animateValue('val-temp', d.temperature, 1);
  animateValue('val-humidity', d.humidity, 1);
  animateValue('val-light', Math.round(d.light), 0);
  animateValue('val-soil', d.soil_moisture, 1);

  // Update progress bars
  updateBar('bar-temp', d.temperature, 15, 45);
  updateBar('bar-humidity', d.humidity, 0, 100);
  updateBar('bar-light', d.light, 0, 100000);
  updateBar('bar-soil', d.soil_moisture, 0, 100);
}

function animateValue(elementId, newValue, decimals) {
  const el = document.getElementById(elementId);
  const formatted = typeof newValue === 'number'
    ? newValue.toLocaleString('vi-VN', { maximumFractionDigits: decimals })
    : '--';

  if (el.textContent !== formatted) {
    el.textContent = formatted;
    el.classList.remove('value-updated');
    void el.offsetWidth; // Force reflow
    el.classList.add('value-updated');
  }
}

function updateBar(barId, value, min, max) {
  const bar = document.getElementById(barId);
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  bar.style.width = `${pct}%`;
}

// ==================== CHARTS ====================
function setupChartControls() {
  document.querySelectorAll('.chart-controls .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-controls .btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentHours = parseInt(btn.dataset.hours);
      loadSensorHistory(currentHours);
    });
  });
}

async function loadSensorHistory(hours) {
  const res = await fetch(`${API_BASE}/api/sensors/history?hours=${hours}`);
  const json = await res.json();

  if (!json.data || json.data.length === 0) return;

  const labels = json.data.map(d => {
    const date = new Date(d.timestamp);
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  });

  // Deduplicate by taking average for same timestamp
  const uniqueData = deduplicateByTime(json.data);
  const uniqueLabels = uniqueData.map(d => {
    const date = new Date(d.timestamp);
    return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  });

  renderTempHumidityChart(uniqueLabels, uniqueData);
  renderLightSoilChart(uniqueLabels, uniqueData);
}

function deduplicateByTime(data) {
  const map = new Map();
  for (const d of data) {
    const key = d.timestamp.substring(0, 16); // Group by minute
    if (!map.has(key)) {
      map.set(key, { ...d, _count: 1 });
    } else {
      const existing = map.get(key);
      existing.temperature = (existing.temperature * existing._count + d.temperature) / (existing._count + 1);
      existing.humidity = (existing.humidity * existing._count + d.humidity) / (existing._count + 1);
      existing.light = (existing.light * existing._count + d.light) / (existing._count + 1);
      existing.soil_moisture = (existing.soil_moisture * existing._count + d.soil_moisture) / (existing._count + 1);
      existing._count++;
    }
  }
  return Array.from(map.values());
}

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: true,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      labels: {
        color: 'rgba(232, 245, 233, 0.7)',
        font: { family: 'Inter', size: 12 },
        usePointStyle: true,
        pointStyle: 'circle'
      }
    },
    tooltip: {
      backgroundColor: 'rgba(10, 15, 13, 0.9)',
      titleColor: '#e8f5e9',
      bodyColor: 'rgba(232, 245, 233, 0.8)',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      cornerRadius: 8,
      padding: 12,
      titleFont: { family: 'Inter', weight: '600' },
      bodyFont: { family: 'Inter' }
    }
  },
  scales: {
    x: {
      ticks: {
        color: 'rgba(232, 245, 233, 0.4)',
        font: { family: 'Inter', size: 10 },
        maxTicksLimit: 12
      },
      grid: { color: 'rgba(255,255,255,0.03)' }
    }
  }
};

function renderTempHumidityChart(labels, data) {
  const ctx = document.getElementById('chart-temp-humidity').getContext('2d');

  if (chartTempHumidity) chartTempHumidity.destroy();

  chartTempHumidity = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Nhiệt độ (°C)',
          data: data.map(d => Math.round(d.temperature * 10) / 10),
          borderColor: '#ff7043',
          backgroundColor: 'rgba(255, 112, 67, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 5,
          yAxisID: 'y'
        },
        {
          label: 'Độ ẩm (%)',
          data: data.map(d => Math.round(d.humidity * 10) / 10),
          borderColor: '#42a5f5',
          backgroundColor: 'rgba(66, 165, 245, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 5,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      ...chartDefaults,
      scales: {
        ...chartDefaults.scales,
        y: {
          position: 'left',
          title: { display: true, text: '°C', color: '#ff7043', font: { family: 'Inter' } },
          ticks: { color: 'rgba(255, 112, 67, 0.6)', font: { family: 'Inter', size: 10 } },
          grid: { color: 'rgba(255,255,255,0.03)' }
        },
        y1: {
          position: 'right',
          title: { display: true, text: '%', color: '#42a5f5', font: { family: 'Inter' } },
          ticks: { color: 'rgba(66, 165, 245, 0.6)', font: { family: 'Inter', size: 10 } },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function renderLightSoilChart(labels, data) {
  const ctx = document.getElementById('chart-light-soil').getContext('2d');

  if (chartLightSoil) chartLightSoil.destroy();

  chartLightSoil = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Ánh sáng (lux)',
          data: data.map(d => Math.round(d.light)),
          borderColor: '#ffca28',
          backgroundColor: 'rgba(255, 202, 40, 0.08)',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 5,
          yAxisID: 'y'
        },
        {
          label: 'Độ ẩm đất (%)',
          data: data.map(d => Math.round(d.soil_moisture * 10) / 10),
          borderColor: '#66bb6a',
          backgroundColor: 'rgba(102, 187, 106, 0.08)',
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 5,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      ...chartDefaults,
      scales: {
        ...chartDefaults.scales,
        y: {
          position: 'left',
          title: { display: true, text: 'lux', color: '#ffca28', font: { family: 'Inter' } },
          ticks: { color: 'rgba(255, 202, 40, 0.6)', font: { family: 'Inter', size: 10 } },
          grid: { color: 'rgba(255,255,255,0.03)' }
        },
        y1: {
          position: 'right',
          title: { display: true, text: '%', color: '#66bb6a', font: { family: 'Inter' } },
          ticks: { color: 'rgba(102, 187, 106, 0.6)', font: { family: 'Inter', size: 10 } },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

// ==================== PEST DETECTIONS ====================
async function loadPestDetections() {
  const [latestRes, statsRes] = await Promise.all([
    fetch(`${API_BASE}/api/pests/latest?limit=10`),
    fetch(`${API_BASE}/api/pests/stats`)
  ]);

  const latest = await latestRes.json();
  const stats = await statsRes.json();

  // Update severity counts
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  if (stats.by_severity) {
    stats.by_severity.forEach(s => {
      severityCounts[s.severity] = s.count;
    });
  }
  document.getElementById('pest-critical').textContent = severityCounts.critical;
  document.getElementById('pest-high').textContent = severityCounts.high;
  document.getElementById('pest-medium').textContent = severityCounts.medium;

  // Render pest list
  const listEl = document.getElementById('pest-list');

  if (!latest.data || latest.data.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <p>Chưa phát hiện sâu bệnh nào</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = latest.data.map((p, i) => `
    <div class="pest-item" style="animation-delay: ${i * 0.05}s">
      <div class="pest-severity-badge ${p.severity}"></div>
      <div class="pest-info">
        <div class="pest-name">${escapeHtml(p.pest_type)}</div>
        <div class="pest-details">
          <span class="pest-detail-item">📍 ${escapeHtml(p.zone_name || 'Không xác định')}</span>
          <span class="pest-detail-item">⚠️ ${getSeverityLabel(p.severity)}</span>
        </div>
        ${p.notes ? `<div class="pest-notes">"${escapeHtml(p.notes)}"</div>` : ''}
      </div>
      <div class="pest-confidence" style="color: ${getConfidenceColor(p.confidence)}">
        ${(p.confidence * 100).toFixed(0)}%
      </div>
      <div class="pest-time">${formatTimeAgo(p.timestamp)}</div>
    </div>
  `).join('');
}

function getSeverityLabel(severity) {
  const labels = {
    critical: 'Nghiêm trọng',
    high: 'Cao',
    medium: 'Trung bình',
    low: 'Thấp'
  };
  return labels[severity] || severity;
}

function getConfidenceColor(confidence) {
  if (confidence >= 0.9) return '#ef5350';
  if (confidence >= 0.8) return '#ff7043';
  if (confidence >= 0.7) return '#ffca28';
  return '#66bb6a';
}

function formatTimeAgo(timestamp) {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Vừa xong';
  if (diffMins < 60) return `${diffMins} phút trước`;
  if (diffHours < 24) return `${diffHours} giờ trước`;
  return `${diffDays} ngày trước`;
}

// ==================== ZONES ====================
async function loadZones() {
  const res = await fetch(`${API_BASE}/api/zones`);
  const json = await res.json();

  const gridEl = document.getElementById('zone-grid');

  if (!json.data || json.data.length === 0) {
    gridEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🗺️</div>
        <p>Chưa có khu vực nào</p>
      </div>
    `;
    return;
  }

  gridEl.innerHTML = json.data.map((z, i) => `
    <div class="zone-card" style="animation-delay: ${i * 0.1}s">
      <div class="zone-header">
        <span class="zone-name">${escapeHtml(z.name)}</span>
        <span class="zone-status ${z.status}">${getStatusLabel(z.status)}</span>
      </div>
      <div class="zone-description">${escapeHtml(z.description || '')}</div>
      <div class="zone-metrics">
        <div class="zone-metric">
          <span class="zone-metric-value" style="color: var(--color-temp)">
            ${z.latest_temp !== null ? z.latest_temp.toFixed(1) + '°' : '--'}
          </span>
          <span class="zone-metric-label">Nhiệt độ</span>
        </div>
        <div class="zone-metric">
          <span class="zone-metric-value" style="color: var(--color-humidity)">
            ${z.latest_humidity !== null ? z.latest_humidity.toFixed(0) + '%' : '--'}
          </span>
          <span class="zone-metric-label">Độ ẩm</span>
        </div>
        <div class="zone-metric">
          <span class="zone-metric-value" style="color: var(--color-soil)">
            ${z.latest_soil_moisture !== null ? z.latest_soil_moisture.toFixed(0) + '%' : '--'}
          </span>
          <span class="zone-metric-label">Đất</span>
        </div>
      </div>
      ${z.pest_count > 0 ? `
        <div class="zone-pest-badge" style="background: var(--severity-medium-bg); color: var(--severity-medium)">
          🔬 ${z.pest_count} phát hiện sâu bệnh
        </div>
      ` : ''}
    </div>
  `).join('');
}

function getStatusLabel(status) {
  const labels = {
    active: 'Hoạt động',
    maintenance: 'Bảo trì',
    inactive: 'Ngừng'
  };
  return labels[status] || status;
}

// ==================== UTILITIES ====================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
