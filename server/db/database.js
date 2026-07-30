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

  // Zones table
  database.exec(`
    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes for performance
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_sensor_timestamp ON sensor_data(timestamp);
    CREATE INDEX IF NOT EXISTS idx_sensor_zone ON sensor_data(zone_id);
    CREATE INDEX IF NOT EXISTS idx_pest_timestamp ON pest_detections(timestamp);
    CREATE INDEX IF NOT EXISTS idx_pest_zone ON pest_detections(zone_id);
  `);

  // Auto-seed default zones & initial data if empty
  const zoneCount = database.prepare('SELECT COUNT(*) as count FROM zones').get();
  if (zoneCount.count === 0) {
    console.log('🌱 Database is empty. Seeding initial zones & data...');
    const insertZone = database.prepare('INSERT INTO zones (name, description, status) VALUES (?, ?, ?)');
    const z1 = insertZone.run('Khu A - Rau ăn lá', 'Trồng rau muống, cải, xà lách', 'active').lastInsertRowid;
    const z2 = insertZone.run('Khu B - Cà chua', 'Trồng cà chua bi và cà chua thường', 'active').lastInsertRowid;
    const z3 = insertZone.run('Khu C - Ớt & Dưa', 'Trồng ớt chỉ thiên, dưa leo', 'active').lastInsertRowid;
    const z4 = insertZone.run('Khu D - Vườn ươm', 'Khu vực ươm giống mới', 'maintenance').lastInsertRowid;

    const zoneIds = [z1, z2, z3, z4];

    console.log('✅ Auto-seeding zones completed');

    console.log('✅ Auto-seeding completed');
  }

  console.log('✅ Database initialized successfully');
}

module.exports = { getDb, initDatabase };
