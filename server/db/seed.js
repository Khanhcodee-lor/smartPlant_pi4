/**
 * Seed data cho Smart Plant Dashboard
 * Chạy: node db/seed.js
 * 
 * Tạo dữ liệu mẫu 24h sensor data + pest detections
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDb, initDatabase } = require('./database');

function seed() {
  const db = getDb();
  initDatabase();

  console.log('🌱 Seeding database...\n');

  // Clear existing data
  db.exec('DELETE FROM pest_detections');
  db.exec('DELETE FROM sensor_data');
  db.exec('DELETE FROM zones');

  // ==================== ZONES ====================
  const insertZone = db.prepare('INSERT INTO zones (name, description, status) VALUES (?, ?, ?)');
  const zones = [
    { name: 'Khu A - Rau ăn lá', description: 'Trồng rau muống, cải, xà lách', status: 'active' },
    { name: 'Khu B - Cà chua', description: 'Trồng cà chua bi và cà chua thường', status: 'active' },
    { name: 'Khu C - Ớt & Dưa', description: 'Trồng ớt chỉ thiên, dưa leo', status: 'active' },
    { name: 'Khu D - Vườn ươm', description: 'Khu vực ươm giống mới', status: 'maintenance' }
  ];

  const zoneIds = [];
  for (const z of zones) {
    const result = insertZone.run(z.name, z.description, z.status);
    zoneIds.push(result.lastInsertRowid);
  }
  console.log(`✅ Created ${zones.length} zones`);

  // ==================== SENSOR DATA ====================
  // Tạo dữ liệu cảm biến 24h, mỗi 15 phút
  const insertSensor = db.prepare(`
    INSERT INTO sensor_data (temperature, humidity, light, soil_moisture, zone_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const now = new Date();
  let sensorCount = 0;

  const insertManySensors = db.transaction(() => {
    for (let hoursAgo = 24; hoursAgo >= 0; hoursAgo -= 0.25) {
      const timestamp = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
      const hour = timestamp.getHours();

      for (const zoneId of zoneIds) {
        // Simulate realistic sensor data patterns
        // Temperature: lower at night (20-24°C), higher during day (28-35°C)
        const baseTemp = hour >= 6 && hour <= 18
          ? 28 + Math.sin((hour - 6) / 12 * Math.PI) * 7
          : 22 + Math.random() * 3;
        const temperature = Math.round((baseTemp + (Math.random() - 0.5) * 2) * 10) / 10;

        // Humidity: higher at night/morning (70-90%), lower midday (50-65%)
        const baseHumidity = hour >= 10 && hour <= 16
          ? 55 + Math.random() * 10
          : 75 + Math.random() * 15;
        const humidity = Math.round((baseHumidity + (Math.random() - 0.5) * 5) * 10) / 10;

        // Light: 0 at night, peaks at noon (~80000 lux)
        const light = hour >= 6 && hour <= 18
          ? Math.round(Math.sin((hour - 6) / 12 * Math.PI) * 80000 + Math.random() * 5000)
          : Math.round(Math.random() * 50);

        // Soil moisture: gradually decreasing, jumps up when "watered"
        const baseSoilMoisture = 60 - (hoursAgo % 8) * 3 + Math.random() * 10;
        const soil_moisture = Math.round(Math.max(25, Math.min(85, baseSoilMoisture)) * 10) / 10;

        insertSensor.run(
          temperature,
          humidity,
          light,
          soil_moisture,
          zoneId,
          timestamp.toISOString()
        );
        sensorCount++;
      }
    }
  });

  insertManySensors();
  console.log(`✅ Created ${sensorCount} sensor readings (24h × 4 zones × every 15min)`);

  // ==================== PEST DETECTIONS ====================
  const insertPest = db.prepare(`
    INSERT INTO pest_detections (pest_type, confidence, image_path, zone_id, severity, notes, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const pests = [
    {
      pest_type: 'Rệp xanh',
      confidence: 0.92,
      zone_id: zoneIds[0],
      severity: 'medium',
      notes: 'Phát hiện trên lá cải xanh, mặt dưới lá',
      hoursAgo: 2
    },
    {
      pest_type: 'Sâu tơ',
      confidence: 0.87,
      zone_id: zoneIds[0],
      severity: 'high',
      notes: 'Sâu non ăn lá rau muống, cần xử lý sớm',
      hoursAgo: 5
    },
    {
      pest_type: 'Bệnh phấn trắng',
      confidence: 0.78,
      zone_id: zoneIds[1],
      severity: 'medium',
      notes: 'Lá cà chua xuất hiện đốm trắng nhẹ',
      hoursAgo: 8
    },
    {
      pest_type: 'Bọ trĩ',
      confidence: 0.95,
      zone_id: zoneIds[2],
      severity: 'critical',
      notes: 'Bọ trĩ trên hoa ớt, mật độ cao',
      hoursAgo: 1
    },
    {
      pest_type: 'Sâu xanh',
      confidence: 0.83,
      zone_id: zoneIds[1],
      severity: 'low',
      notes: 'Sâu xanh da láng trên quả cà chua, số lượng ít',
      hoursAgo: 12
    },
    {
      pest_type: 'Rệp xanh',
      confidence: 0.89,
      zone_id: zoneIds[2],
      severity: 'medium',
      notes: 'Rệp trên chồi non dưa leo',
      hoursAgo: 18
    },
    {
      pest_type: 'Bệnh sương mai',
      confidence: 0.71,
      zone_id: zoneIds[0],
      severity: 'low',
      notes: 'Nghi ngờ sương mai trên xà lách, cần theo dõi thêm',
      hoursAgo: 24
    },
    {
      pest_type: 'Bọ trĩ',
      confidence: 0.91,
      zone_id: zoneIds[2],
      severity: 'high',
      notes: 'Bọ trĩ xuất hiện lại trên lá ớt, đã xử lý lần 1',
      hoursAgo: 36
    }
  ];

  for (const p of pests) {
    const timestamp = new Date(now.getTime() - p.hoursAgo * 60 * 60 * 1000);
    insertPest.run(
      p.pest_type,
      p.confidence,
      null, // image_path — sẽ thêm khi có camera thực
      p.zone_id,
      p.severity,
      p.notes,
      timestamp.toISOString()
    );
  }
  console.log(`✅ Created ${pests.length} pest detection records`);

  console.log('\n🎉 Seeding completed!');
  console.log('   Run "npm run dev" to start the server');
}

seed();
