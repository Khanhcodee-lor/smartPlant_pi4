const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { getDb } = require('../db/database');
const { getFirebaseServices } = require('../firebase');

function getTestImagesDir() {
  const candidates = [
    path.join(__dirname, '../../ai_engine/test_images'),
    path.join(__dirname, '../ai_engine/test_images'),
    path.join(process.cwd(), 'ai_engine/test_images'),
    path.join(process.cwd(), '../ai_engine/test_images'),
    '/home/toan/Smart_Plant/ai_engine/test_images',
    '/home/khanh/Workspace_company/pi_4/Smart_Plant/ai_engine/test_images'
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  const fallback = path.join(__dirname, '../../ai_engine/test_images');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

// GET /api/pests/test-images — Danh sách ảnh test trong thẻ nhớ
router.get('/test-images', (req, res) => {
  try {
    const dir = getTestImagesDir();
    const files = fs.readdirSync(dir).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.bmp'].includes(ext);
    });

    res.json({
      directory: dir,
      images: files.map(filename => ({
        filename,
        url: `/api/pests/test-image/${encodeURIComponent(filename)}`
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pests/test-image/:filename — Xem trực tiếp ảnh test
router.get('/test-image/:filename', (req, res) => {
  try {
    const dir = getTestImagesDir();
    const filePath = path.join(dir, req.params.filename);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pests/upload-test — Tải thêm ảnh test vào thẻ nhớ
router.post('/upload-test', (req, res) => {
  try {
    const { image_base64, filename } = req.body;
    if (!image_base64) {
      return res.status(400).json({ error: 'image_base64 is required' });
    }

    const dir = getTestImagesDir();
    const safeName = (filename || `test_${Date.now()}.jpg`).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = path.join(dir, safeName);

    // Remove base64 header if exists
    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    res.json({
      message: 'Upload test image successful',
      filename: safeName,
      url: `/api/pests/test-image/${encodeURIComponent(safeName)}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const { execFile } = require('child_process');

function getEngineBinaryPath() {
  const candidates = [
    '/home/toan/Smart_Plant/ai_engine/build/smart_plant_engine',
    path.join(__dirname, '../../ai_engine/build/smart_plant_engine'),
    path.join(__dirname, '../../ai_engine/build_pi/smart_plant_engine'),
    path.join(process.cwd(), 'ai_engine/build/smart_plant_engine'),
    path.join(process.cwd(), '../ai_engine/build/smart_plant_engine'),
    // Fallback: tìm ở thư mục gốc (nếu ai đó copy ra ngoài)
    '/home/toan/Smart_Plant/ai_engine/smart_plant_engine',
    path.join(process.cwd(), 'ai_engine/smart_plant_engine')
  ];
  for (const b of candidates) {
    if (fs.existsSync(b)) return b;
  }
  return candidates[0];
}

function analyzeImage(binary, filePath) {
  return new Promise((resolve, reject) => {
    execFile(binary, ['--analyze', filePath], {
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 50
    }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`AI engine lỗi: ${error.message}${stderr ? `; ${stderr.trim()}` : ''}`));
      }

      const lines = stdout.trim().split('\n');
      const jsonLine = [...lines].reverse().find(line => line.trim().startsWith('{'));
      if (!jsonLine) return reject(new Error('Không đọc được JSON từ AI engine'));

      try {
        resolve(JSON.parse(jsonLine));
      } catch (parseError) {
        reject(new Error(`JSON AI không hợp lệ: ${parseError.message}`));
      }
    });
  });
}

function hasPestDetection(result) {
  const pestType = String(result?.pest_type || '').trim();
  return Boolean(pestType && !/healthy|cây khỏe mạnh/i.test(pestType));
}

function getCaptureTimeFields(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const value = type => parts.find(part => part.type === type)?.value;
  return {
    capture_date: `${value('year')}-${value('month')}-${value('day')}`,
    capture_time: `${value('hour')}:${value('minute')}:${value('second')}`,
    capture_timezone: 'Asia/Ho_Chi_Minh'
  };
}

const CAPTURE_COLLECTION = 'plant_captures';

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getCaptureDate(record) {
  return parseDate(record.captured_at_iso || record.timestamp || record.captured_at);
}

function comparableImagePath(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function findMatchingFirebaseCapture(row, firebaseDocs, usedCaptureIds = new Set()) {
  const imagePath = comparableImagePath(row.image_path);
  if (imagePath) {
    const imageMatch = firebaseDocs.find(doc => {
      if (usedCaptureIds.has(doc.id)) return false;
      const record = doc.data();
      if (record.status !== 'detected') return false;
      return [record.image_path, record.original_image_url, record.annotated_image_url]
        .some(candidate => comparableImagePath(candidate) === imagePath);
    });
    if (imageMatch) return imageMatch;
  }

  const rowDate = parseDate(row.timestamp);
  if (!rowDate) return null;
  const pestType = String(row.pest_type || '').trim().toLowerCase();
  const confidence = Number(row.confidence);
  const zoneId = row.zone_id == null ? '' : String(row.zone_id);
  let closestMatch = null;
  let closestDelta = Infinity;

  for (const doc of firebaseDocs) {
    if (usedCaptureIds.has(doc.id)) continue;
    const record = doc.data();
    if (record.status !== 'detected' || String(record.pest_type || '').trim().toLowerCase() !== pestType) continue;
    if (zoneId && String(record.zone_id ?? '') !== zoneId) continue;
    if (row.severity && record.severity && String(record.severity) !== String(row.severity)) continue;
    if (Number.isFinite(confidence) && Number.isFinite(Number(record.confidence)) &&
        Math.abs(Number(record.confidence) - confidence) > 0.001) continue;

    const captureDate = getCaptureDate(record);
    if (!captureDate) continue;
    const delta = Math.abs(captureDate.getTime() - rowDate.getTime());
    if (delta <= 120000 && delta < closestDelta) {
      closestMatch = doc;
      closestDelta = delta;
    }
  }

  return closestMatch;
}

function sqliteRowToFirebaseCapture(row, captureId) {
  const capturedAt = parseDate(row.timestamp) || new Date();
  return {
    capture_id: captureId,
    source: 'sqlite_history',
    status: 'detected',
    captured_at: capturedAt,
    captured_at_iso: capturedAt.toISOString(),
    ...getCaptureTimeFields(capturedAt),
    zone_id: row.zone_id == null ? null : Number(row.zone_id),
    zone_name: row.zone_name || null,
    pest_type: row.pest_type || null,
    confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null,
    severity: row.severity || null,
    notes: row.notes || null,
    image_path: row.image_path || null,
    original_image_url: row.image_path || null,
    sqlite_detection_id: Number(row.id)
  };
}

async function syncPendingSqliteHistory(db, firestore) {
  const pendingRows = db.prepare(`
    SELECT p.*, z.name AS zone_name
    FROM pest_detections p
    LEFT JOIN zones z ON p.zone_id = z.id
    WHERE p.firebase_capture_id IS NULL
    ORDER BY p.id ASC
  `).all();
  if (!pendingRows.length) return 0;

  const collection = firestore.collection(CAPTURE_COLLECTION);
  const existingSnapshot = await collection.where('status', '==', 'detected').get();
  const existingDocs = existingSnapshot.docs;
  const usedCaptureIds = new Set();
  const updateLocalLink = db.prepare(`
    UPDATE pest_detections SET firebase_capture_id = ?
    WHERE id = ? AND firebase_capture_id IS NULL
  `);

  for (let offset = 0; offset < pendingRows.length; offset += 400) {
    const rows = pendingRows.slice(offset, offset + 400);
    const batch = firestore.batch();
    const links = [];
    let batchWriteCount = 0;

    for (const row of rows) {
      const matchingDoc = findMatchingFirebaseCapture(row, existingDocs, usedCaptureIds);
      const captureId = matchingDoc?.id || `sqlite-history-${row.id}`;
      if (matchingDoc) {
        usedCaptureIds.add(matchingDoc.id);
      } else {
        batch.set(collection.doc(captureId), sqliteRowToFirebaseCapture(row, captureId), { merge: true });
        batchWriteCount += 1;
      }
      links.push({ captureId, sqliteId: row.id });
    }

    if (batchWriteCount) await batch.commit();
    for (const link of links) updateLocalLink.run(link.captureId, link.sqliteId);
  }

  return pendingRows.length;
}

async function syncSqliteRowToFirebase(db, firestore, row) {
  const captureId = row.firebase_capture_id || `sqlite-history-${row.id}`;
  await firestore.collection(CAPTURE_COLLECTION).doc(captureId)
    .set(sqliteRowToFirebaseCapture(row, captureId), { merge: true });
  db.prepare(`
    UPDATE pest_detections SET firebase_capture_id = ?
    WHERE id = ? AND firebase_capture_id IS NULL
  `).run(captureId, row.id);
  return captureId;
}

function mapFirebaseCapture(doc, zoneNames) {
  const record = doc.data();
  const capturedAt = getCaptureDate(record);
  return {
    id: doc.id,
    capture_id: record.capture_id || doc.id,
    firebase_capture_id: doc.id,
    source: record.source || null,
    pest_type: record.pest_type || 'Không rõ bệnh',
    confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0,
    image_path: record.annotated_image_url || record.original_image_url || record.image_path || null,
    zone_id: record.zone_id ?? null,
    zone_name: record.zone_name || zoneNames.get(String(record.zone_id ?? '')) || null,
    severity: record.severity || 'low',
    notes: record.notes || null,
    timestamp: capturedAt?.toISOString() || null
  };
}

function mapSqliteHistoryRow(row) {
  const capturedAt = parseDate(row.timestamp);
  return {
    id: row.firebase_capture_id || `sqlite-${row.id}`,
    sqlite_id: Number(row.id),
    firebase_capture_id: row.firebase_capture_id || null,
    pest_type: row.pest_type,
    confidence: Number(row.confidence),
    image_path: row.image_path || null,
    zone_id: row.zone_id ?? null,
    zone_name: row.zone_name || null,
    severity: row.severity || 'low',
    notes: row.notes || null,
    timestamp: capturedAt?.toISOString() || row.timestamp
  };
}

async function uploadCaptureImage(bucket, getDownloadURL, captureId, filename, bytes, contentType = 'image/jpeg') {
  const storagePath = `plant-captures/${captureId}/${filename}`;
  const file = bucket.file(storagePath);
  const downloadToken = randomUUID();
  await file.save(bytes, {
    resumable: false,
    metadata: {
      contentType,
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        captureId
      }
    }
  });

  return {
    storagePath,
    downloadUrl: await getDownloadURL(file)
  };
}

async function saveTestImageCapture(filename, filePath, result, zoneId, capturedAt) {
  const captureId = randomUUID();
  const { firestore, bucket, FieldValue, getDownloadURL } = getFirebaseServices();
  const extension = path.extname(filename).toLowerCase() || '.jpg';
  const contentTypeByExtension = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.bmp': 'image/bmp'
  };
  const originalImage = await uploadCaptureImage(
    bucket, getDownloadURL, captureId, `original${extension}`,
    fs.readFileSync(filePath), contentTypeByExtension[extension]
  );

  let annotatedImage = null;
  let annotationStorageError = null;
  if (hasPestDetection(result) && result.image_path) {
    const publicDir = path.resolve(__dirname, '../public');
    const annotatedName = path.basename(String(result.image_path).split('?')[0]);
    const annotatedPath = path.resolve(publicDir, annotatedName);
    if (annotatedPath.startsWith(`${publicDir}${path.sep}`) && fs.existsSync(annotatedPath)) {
      try {
        annotatedImage = await uploadCaptureImage(
          bucket, getDownloadURL, captureId, 'ai-annotated.jpg',
          fs.readFileSync(annotatedPath), 'image/jpeg'
        );
      } catch (error) {
        annotationStorageError = error.message;
        console.error('[Test Image] Không lưu được ảnh AI chú thích:', annotationStorageError);
      }
    }
  }

  const confidenceValue = result?.confidence;
  const confidence = confidenceValue !== null && confidenceValue !== undefined && confidenceValue !== '' &&
    Number.isFinite(Number(confidenceValue)) ? Number(confidenceValue) : null;
  const record = {
    capture_id: captureId,
    source: 'pi_test_image',
    source_location: 'raspberry_pi_test_images',
    source_filename: filename,
    source_path: `ai_engine/test_images/${filename}`,
    status: hasPestDetection(result) ? 'detected' : 'no_detection',
    captured_at: FieldValue.serverTimestamp(),
    captured_at_iso: capturedAt.toISOString(),
    ...getCaptureTimeFields(capturedAt),
    zone_id: Number(result?.zone_id || zoneId),
    pest_type: result?.pest_type || null,
    confidence,
    severity: result?.severity || null,
    notes: result?.notes || null,
    original_storage_path: originalImage.storagePath,
    original_image_url: originalImage.downloadUrl,
    annotated_storage_path: annotatedImage?.storagePath || null,
    annotated_image_url: annotatedImage?.downloadUrl || null,
    analysis_error: null,
    annotation_storage_error: annotationStorageError
  };
  await firestore.collection('plant_captures').doc(captureId).set(record);

  return { captureId, originalImage, annotatedImage, record, confidence };
}

// POST /api/pests/analyze — Phân tích ảnh trên Pi và lưu ảnh/kết quả lên Firebase
router.post('/analyze', async (req, res) => {
  try {
    const { filename, image_path } = req.body;
    const requestedImage = filename || image_path;
    const imageName = requestedImage ? path.basename(String(requestedImage)) : '';
    const testImagesDir = path.resolve(getTestImagesDir());
    const targetPath = imageName ? path.resolve(testImagesDir, imageName) : '';

    if (!imageName || !targetPath.startsWith(`${testImagesDir}${path.sep}`) || !fs.existsSync(targetPath)) {
      return res.status(400).json({ error: 'File ảnh không tồn tại: ' + targetPath });
    }
    const extension = path.extname(imageName).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.bmp'].includes(extension)) {
      return res.status(400).json({ error: 'Định dạng ảnh test không được hỗ trợ.' });
    }

    const binary = getEngineBinaryPath();
    if (!fs.existsSync(binary)) {
      return res.status(500).json({ error: 'Không tìm thấy binary smart_plant_engine: ' + binary });
    }

    const capturedAt = new Date();
    const result = await analyzeImage(binary, targetPath);
    if (!result || typeof result !== 'object') {
      throw new Error('AI engine không trả về kết quả nhận diện hợp lệ.');
    }
    const requestedZoneId = Number(req.body?.zone_id ?? 1);
    const zoneId = Number.isInteger(requestedZoneId) && requestedZoneId > 0 ? requestedZoneId : 1;
    if (result.zone_id == null) result.zone_id = zoneId;

    const saved = await saveTestImageCapture(imageName, targetPath, result, zoneId, capturedAt);

    let localHistoryError = null;
    if (hasPestDetection(result)) {
      try {
        const db = getDb();
        db.prepare(`
          INSERT INTO pest_detections
            (pest_type, confidence, image_path, zone_id, severity, notes, firebase_capture_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          result.pest_type,
          saved.confidence ?? 0.9,
          saved.annotatedImage?.downloadUrl || result.image_path || saved.originalImage.downloadUrl,
          Number(result.zone_id || zoneId),
          result.severity || 'medium',
          result.notes || 'Phân tích ảnh test từ thẻ nhớ Pi',
          saved.captureId
        );
      } catch (error) {
        localHistoryError = error.message;
        console.error('[Test Image] Firebase đã lưu nhưng SQLite history ghi lỗi:', localHistoryError);
      }
    }

    res.json({
      success: true,
      analysis_status: saved.record.status,
      local_history_error: localHistoryError,
      data: result,
      capture: {
        id: saved.captureId,
        source_filename: imageName,
        original_storage_path: saved.originalImage.storagePath,
        original_image_url: saved.originalImage.downloadUrl,
        annotated_storage_path: saved.annotatedImage?.storagePath || null,
        annotated_image_url: saved.annotatedImage?.downloadUrl || null
      }
    });
  } catch (err) {
    console.error('[Test Image Analyze Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const axios = require('axios');
const USTREAMER_URL = process.env.USTREAMER_URL || 'http://127.0.0.1:8080';

// POST /api/pests/capture-analyze — Chụp snapshot từ camera rồi phân tích AI ngay (tất cả phía server)
router.post('/capture-analyze', async (req, res) => {
  const captureId = randomUUID();
  let capturedAt;
  let filePath;

  try {
    console.log('[Capture] Đang chụp snapshot từ camera...');
    let snapshotData;
    try {
      const snapRes = await axios.get(`${USTREAMER_URL}/snapshot`, { 
        responseType: 'arraybuffer',
        timeout: 10000 
      });
      snapshotData = Buffer.from(snapRes.data);
    } catch (snapErr) {
      console.error('[Capture] Lỗi chụp snapshot:', snapErr.message);
      return res.status(502).json({ error: 'Không thể chụp ảnh từ camera: ' + snapErr.message });
    }

    capturedAt = new Date();
    const captureDateFields = getCaptureTimeFields(capturedAt);

    const filename = `capture_${capturedAt.toISOString().replace(/[:.]/g, '-')}.jpg`;
    const dir = getTestImagesDir();
    filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, snapshotData);
    console.log(`[Capture] Đã lưu ảnh: ${filePath} (${snapshotData.length} bytes)`);

    const binary = getEngineBinaryPath();
    const requestedZoneId = Number(req.body?.zone_id ?? 1);
    const zoneId = Number.isInteger(requestedZoneId) && requestedZoneId > 0 ? requestedZoneId : 1;
    let result = null;
    let analysisStatus = 'analysis_failed';
    let analysisError = null;

    try {
      if (!fs.existsSync(binary)) {
        throw new Error('Không tìm thấy binary smart_plant_engine: ' + binary);
      }
      result = await analyzeImage(binary, filePath);
      if (result && typeof result === 'object') {
        if (result.zone_id == null) result.zone_id = zoneId;
        analysisStatus = hasPestDetection(result) ? 'detected' : 'no_detection';
      } else {
        result = null;
        analysisStatus = 'no_detection';
      }
    } catch (error) {
      analysisError = error.message;
      console.error('[Capture AI Error]:', analysisError);
    }

    const { firestore, bucket, FieldValue, getDownloadURL } = getFirebaseServices();
    const originalImage = await uploadCaptureImage(
      bucket, getDownloadURL, captureId, 'original.jpg', snapshotData
    );

    let annotatedImage = null;
    let annotationStorageError = null;
    if (hasPestDetection(result) && result.image_path) {
      const publicDir = path.resolve(__dirname, '../public');
      const annotatedName = path.basename(String(result.image_path).split('?')[0]);
      const annotatedPath = path.resolve(publicDir, annotatedName);
      if (annotatedPath.startsWith(`${publicDir}${path.sep}`) && fs.existsSync(annotatedPath)) {
        try {
          annotatedImage = await uploadCaptureImage(
            bucket, getDownloadURL, captureId, 'ai-annotated.jpg', fs.readFileSync(annotatedPath)
          );
        } catch (error) {
          annotationStorageError = error.message;
          console.error('[Capture] Không lưu được ảnh AI chú thích:', annotationStorageError);
        }
      }
    }

    const confidenceValue = result?.confidence;
    const confidence = confidenceValue !== null && confidenceValue !== undefined && confidenceValue !== '' &&
      Number.isFinite(Number(confidenceValue)) ? Number(confidenceValue) : null;

    const captureRecord = {
      capture_id: captureId,
      source: 'camera',
      status: analysisStatus,
      captured_at: FieldValue.serverTimestamp(),
      captured_at_iso: capturedAt.toISOString(),
      ...captureDateFields,
      zone_id: Number(result?.zone_id || zoneId),
      pest_type: result?.pest_type || null,
      confidence,
      severity: result?.severity || null,
      notes: result?.notes || null,
      original_storage_path: originalImage.storagePath,
      original_image_url: originalImage.downloadUrl,
      annotated_storage_path: annotatedImage?.storagePath || null,
      annotated_image_url: annotatedImage?.downloadUrl || null,
      analysis_error: analysisError,
      annotation_storage_error: annotationStorageError
    };
    await firestore.collection('plant_captures').doc(captureId).set(captureRecord);

    if (hasPestDetection(result)) {
      const db = getDb();
      db.prepare(`
        INSERT INTO pest_detections
          (pest_type, confidence, image_path, zone_id, severity, notes, firebase_capture_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        result.pest_type,
        confidence ?? 0.9,
        annotatedImage?.downloadUrl || result.image_path || originalImage.downloadUrl,
        captureRecord.zone_id,
        result.severity || 'medium',
        result.notes || 'Chụp trực tiếp từ camera và phân tích',
        captureId
      );
    }

    if (analysisError) {
      return res.json({
        success: true,
        analysis_status: analysisStatus,
        analysis_error: analysisError,
        data: null,
        capture: {
          id: captureId,
          original_storage_path: originalImage.storagePath,
          original_image_url: originalImage.downloadUrl,
          preview_url: `/api/pests/test-image/${encodeURIComponent(filename)}`
        }
      });
    }

    if (result && !result.image_path) {
      result.image_path = `/api/pests/test-image/${encodeURIComponent(filename)}`;
    }
    console.log(`[Capture] Đã lưu Firestore/Storage: ${captureId} (${analysisStatus})`);
    res.json({
      success: true,
      analysis_status: analysisStatus,
      data: result,
      capture: {
        id: captureId,
        original_storage_path: originalImage.storagePath,
        original_image_url: originalImage.downloadUrl,
        annotated_storage_path: annotatedImage?.storagePath || null,
        annotated_image_url: annotatedImage?.downloadUrl || null,
        preview_url: `/api/pests/test-image/${encodeURIComponent(filename)}`
      }
    });
  } catch (err) {
    console.error('[Capture] Lỗi tổng:', err.message);
    res.status(500).json({
      error: err.message,
      capture_id: captureId,
      local_image_saved: Boolean(filePath && fs.existsSync(filePath)),
      preview_url: filePath && fs.existsSync(filePath)
        ? `/api/pests/test-image/${encodeURIComponent(path.basename(filePath))}`
        : null
    });
  }
});


// GET /api/pests/latest — Lấy phát hiện sâu bệnh mới nhất
router.get('/latest', (req, res) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit) || 10;

    const rows = db.prepare(`
      SELECT p.*, z.name as zone_name
      FROM pest_detections p
      LEFT JOIN zones z ON p.zone_id = z.id
      ORDER BY p.timestamp DESC
      LIMIT ?
    `).all(limit);

    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pests/history?days=7 — Hợp nhất SQLite và Firestore, đồng thời
// đồng bộ các bản ghi SQLite cũ chưa có liên kết Firebase.
router.get('/history', async (req, res) => {
  try {
    const db = getDb();
    const parsedDays = parseInt(req.query.days, 10) || 7;
    const days = Math.max(1, Math.min(parsedDays, 3650));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const localRows = db.prepare(`
      SELECT p.*, z.name AS zone_name
      FROM pest_detections p
      LEFT JOIN zones z ON p.zone_id = z.id
      WHERE p.timestamp >= datetime('now', ?)
      ORDER BY p.timestamp DESC
    `).all(`-${days} days`);

    const zoneNames = new Map(
      db.prepare('SELECT id, name FROM zones').all().map(zone => [String(zone.id), zone.name])
    );

    try {
      const { firestore, Timestamp } = getFirebaseServices();
      let syncedSqliteRows = 0;
      try {
        syncedSqliteRows = await syncPendingSqliteHistory(db, firestore);
      } catch (syncError) {
        console.error('[Pest History] Không đồng bộ được SQLite lên Firestore:', syncError.message);
      }

      const snapshot = await firestore.collection(CAPTURE_COLLECTION)
        .where('captured_at', '>=', Timestamp.fromDate(cutoff))
        .get();
      const firebaseDocs = snapshot.docs.filter(doc => doc.data().status === 'detected');
      const firebaseItems = firebaseDocs
        .map(doc => mapFirebaseCapture(doc, zoneNames))
        .filter(item => {
          const date = parseDate(item.timestamp);
          return date && date >= cutoff;
        });
      const firebaseItemsById = new Map(firebaseItems.map(item => [item.firebase_capture_id, item]));
      const usedCaptureIds = new Set();
      const history = [...firebaseItems];

      for (const row of localRows) {
        let captureId = row.firebase_capture_id || null;
        if (!captureId) {
          const matchingDoc = findMatchingFirebaseCapture(row, firebaseDocs, usedCaptureIds);
          captureId = matchingDoc?.id || null;
        }
        if (captureId && firebaseItemsById.has(captureId)) {
          usedCaptureIds.add(captureId);
          continue;
        }
        history.push(mapSqliteHistoryRow(row));
      }

      history.sort((left, right) => (parseDate(right.timestamp)?.getTime() || 0) -
        (parseDate(left.timestamp)?.getTime() || 0));
      return res.json({
        data: history,
        count: history.length,
        sources: { sqlite: true, firebase: true },
        sqlite_rows_synced: syncedSqliteRows
      });
    } catch (firebaseError) {
      console.error('[Pest History] Firestore chưa khả dụng, trả lịch sử SQLite:', firebaseError.message);
      const history = localRows.map(mapSqliteHistoryRow);
      return res.json({
        data: history,
        count: history.length,
        sources: { sqlite: true, firebase: false },
        firebase_error: firebaseError.message
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pests/stats — Thống kê sâu bệnh theo loại
router.get('/stats', (req, res) => {
  try {
    const db = getDb();

    const byType = db.prepare(`
      SELECT pest_type, COUNT(*) as count, AVG(confidence) as avg_confidence,
             MAX(timestamp) as last_detected
      FROM pest_detections
      GROUP BY pest_type
      ORDER BY count DESC
    `).all();

    const bySeverity = db.prepare(`
      SELECT severity, COUNT(*) as count
      FROM pest_detections
      GROUP BY severity
      ORDER BY 
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END
    `).all();

    const total = db.prepare('SELECT COUNT(*) as total FROM pest_detections').get();

    res.json({
      total: total.total,
      by_type: byType,
      by_severity: bySeverity
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pests — Ghi kết quả phát hiện sâu bệnh mới (từ AI engine)
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const { pest_type, confidence, image_path, zone_id, severity, notes } = req.body;

    if (!pest_type || confidence === undefined) {
      return res.status(400).json({ error: 'pest_type and confidence are required' });
    }

    const stmt = db.prepare(`
      INSERT INTO pest_detections (pest_type, confidence, image_path, zone_id, severity, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      pest_type,
      confidence,
      image_path || null,
      zone_id || null,
      severity || 'low',
      notes || null
    );

    const row = db.prepare(`
      SELECT p.*, z.name AS zone_name
      FROM pest_detections p
      LEFT JOIN zones z ON p.zone_id = z.id
      WHERE p.id = ?
    `).get(result.lastInsertRowid);

    let firebaseCaptureId = null;
    let firebaseSyncError = null;
    try {
      const { firestore } = getFirebaseServices();
      firebaseCaptureId = await syncSqliteRowToFirebase(db, firestore, row);
    } catch (error) {
      firebaseSyncError = error.message;
      console.error('[Pest Detection] SQLite lưu được nhưng Firebase đồng bộ lỗi:', firebaseSyncError);
    }

    res.status(201).json({
      message: 'Pest detection recorded',
      id: result.lastInsertRowid,
      firebase_capture_id: firebaseCaptureId,
      firebase_sync_error: firebaseSyncError
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pests/all — Xóa toàn bộ lịch sử phát hiện sâu bệnh
router.delete('/all', async (req, res) => {
  try {
    const db = getDb();
    const { firestore } = getFirebaseServices();
    const collection = firestore.collection(CAPTURE_COLLECTION);
    const snapshot = await collection.where('status', '==', 'detected').get();

    for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
      const batch = firestore.batch();
      for (const doc of snapshot.docs.slice(offset, offset + 400)) batch.delete(doc.ref);
      await batch.commit();
    }

    const result = db.prepare('DELETE FROM pest_detections').run();
    res.json({
      success: true,
      message: 'Đã xóa lịch sử phát hiện trên SQLite và Firestore',
      changes: result.changes,
      firebase_changes: snapshot.size
    });
  } catch (err) {
    res.status(502).json({ error: `Không thể đồng bộ xóa lịch sử với Firebase: ${err.message}` });
  }
});

module.exports = router;
