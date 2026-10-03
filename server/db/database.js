const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'smart_plant.db');

let db;

const fs = require('fs');

function getDb() {
  if (!db) {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const database = getDb();

  // Sensor data table
  database.exec(`
    CREATE TABLE IF NOT EXISTS sensor_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temperature REAL,
      humidity REAL,
      light REAL,
      soil_moisture REAL,
      zone_id INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (zone_id) REFERENCES zones(id)
    )
  `);

  // Pest detections table
  database.exec(`
    CREATE TABLE IF NOT EXISTS pest_detections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pest_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      image_path TEXT,
      zone_id INTEGER,
      severity TEXT DEFAULT 'low',
      notes TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (zone_id) REFERENCES zones(id)
    )
  `);

  // Link local detections to their Firestore capture so both sources can be
  // merged without showing the same detection twice.
  const pestColumns = database.pragma('table_info(pest_detections)');
  if (!pestColumns.some(column => column.name === 'firebase_capture_id')) {
    database.exec('ALTER TABLE pest_detections ADD COLUMN firebase_capture_id TEXT');
  }

  // Zones table
  database.exec(`
    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      status TEXT DEFAULT 'active',
      mesh_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // BLE Mesh nodes table
  database.exec(`
    CREATE TABLE IF NOT EXISTS ble_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      mesh_address TEXT,
      name TEXT,
      zone_id INTEGER,
      status TEXT DEFAULT 'unprovisioned',
      last_seen DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (zone_id) REFERENCES zones(id)
    )
  `);


  // Create indexes for performance
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_sensor_timestamp ON sensor_data(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sensor_zone ON sensor_data(zone_id);
    CREATE INDEX IF NOT EXISTS idx_pest_timestamp ON pest_detections(timestamp);
    CREATE INDEX IF NOT EXISTS idx_pest_zone ON pest_detections(zone_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pest_firebase_capture_id
      ON pest_detections(firebase_capture_id)
      WHERE firebase_capture_id IS NOT NULL;
  `);

  // Zones are created dynamically when ESP32 nodes join the BLE Mesh network.
  // No auto-seeding needed.
  
  console.log('✅ Database initialized successfully');
}

module.exports = { getDb, initDatabase };
