require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDatabase } = require('./db/database');
const sensorRoutes = require('./routes/sensor');
const pestRoutes = require('./routes/pest');
const zoneRoutes = require('./routes/zone');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/sensors', sensorRoutes);
app.use('/api/pests', pestRoutes);
app.use('/api/zones', zoneRoutes);

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
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize database and start server
initDatabase();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌱 Smart Plant Server running at http://0.0.0.0:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api`);
});
