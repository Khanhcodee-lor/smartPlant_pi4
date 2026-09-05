require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDatabase } = require('./db/database');
const sensorRoutes = require('./routes/sensor');
const pestRoutes = require('./routes/pest');
const zoneRoutes = require('./routes/zone');
const chatRoutes = require('./routes/chat');
const cameraRoutes = require('./routes/camera');
const wifiRoutes = require('./routes/wifi');
const bleRoutes = require('./routes/ble');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/sensors', sensorRoutes);
app.use('/api/pests', pestRoutes);
app.use('/api/zones', zoneRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/camera', cameraRoutes);
app.use('/api/wifi', wifiRoutes);
app.use('/api/ble', bleRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Fallback to index.html for SPA-like behavior
app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Initialize database and start server
initDatabase();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌱 Smart Plant Server running at http://0.0.0.0:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api`);
});
