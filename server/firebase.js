const fs = require('fs');
const path = require('path');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { getDownloadURL, getStorage } = require('firebase-admin/storage');

const APP_NAME = 'smart-plant-firebase';

function getFirebaseServices() {
  const credentialPath = path.resolve(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(__dirname, '../ai_engine/config/pi4-iot.json')
  );

  if (!fs.existsSync(credentialPath)) {
    throw new Error(`Firebase service account file not found: ${credentialPath}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
  const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (!projectId || projectId !== serviceAccount.project_id) {
    throw new Error('FIREBASE_PROJECT_ID does not match the Firebase service account project.');
  }

  // New Firebase projects use *.firebasestorage.app by default. Override this
  // with the exact bucket name shown in Firebase Console → Storage if needed.
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
  let app = getApps().find(item => item.name === APP_NAME);
  if (!app) {
    app = initializeApp({
      credential: cert(serviceAccount),
      projectId,
      storageBucket
    }, APP_NAME);
  }

  return {
    firestore: getFirestore(app),
    bucket: getStorage(app).bucket(storageBucket),
    FieldValue,
    getDownloadURL
  };
}

module.exports = { getFirebaseServices };
