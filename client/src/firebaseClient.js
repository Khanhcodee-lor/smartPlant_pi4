import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDt9I0J9-GcLQDkPR4moJrE94W2HzEZORE',
  authDomain: 'pi4-iot-1b7bb.firebaseapp.com',
  projectId: 'pi4-iot-1b7bb',
  appId: '1:99901555407:web:44ef9bb83befa111b8edba',
  messagingSenderId: '99901555407',
  storageBucket: 'pi4-iot-1b7bb.firebasestorage.app',
};

const FUNCTIONS_REGION = 'asia-southeast1';
let services;

function getFirebaseServices() {
  if (services) return services;

  if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.appId || !FIREBASE_CONFIG.projectId) {
    const error = new Error('Thiếu cấu hình Firebase Web App.');
    error.code = 'firebase/configuration';
    throw error;
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG);
  services = {
    auth: getAuth(app),
    functions: getFunctions(app, FUNCTIONS_REGION),
  };
  return services;
}

export function observeFirebaseUser(onUser, onError) {
  const { auth } = getFirebaseServices();
  return onAuthStateChanged(auth, onUser, onError);
}

export async function signInToFirebaseWithGoogle() {
  const { auth } = getFirebaseServices();
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signOutFromFirebase() {
  const { auth } = getFirebaseServices();
  return signOut(auth);
}

export async function callAskChatbot(data) {
  const { auth, functions } = getFirebaseServices();
  if (!auth.currentUser) {
    const error = new Error('Bạn cần đăng nhập để sử dụng trợ lý AI.');
    error.code = 'functions/unauthenticated';
    throw error;
  }

  const askChatbot = httpsCallable(functions, 'askChatbot', { timeout: 65000 });
  return askChatbot(data);
}

export function describeFirebaseChatError(error) {
  const code = String(error?.code || '').replace(/^(auth|functions|firebase)\//, '');
  const message = typeof error?.message === 'string' ? error.message : '';

  if (code === 'configuration') {
    return 'Cấu hình Firebase Web App không hợp lệ. Kiểm tra cấu hình được lấy từ Flutter app.';
  }
  if (code === 'unauthorized-domain') {
    return 'Tên miền hoặc địa chỉ Raspberry Pi chưa được thêm vào Firebase Authentication → Authorized domains.';
  }
  if (code === 'operation-not-allowed' || code === 'provider-already-linked') {
    return 'Google Sign-In chưa được bật trong Firebase Authentication.';
  }
  if (code === 'popup-closed-by-user') {
    return 'Cửa sổ đăng nhập Google đã bị đóng trước khi hoàn tất.';
  }
  if (code === 'popup-blocked') {
    return 'Trình duyệt đã chặn cửa sổ Google Sign-In. Cho phép popup rồi thử lại.';
  }
  if (code === 'network-request-failed' || code === 'unavailable') {
    return 'Mất kết nối tới Firebase. Kiểm tra mạng của trình duyệt/Raspberry Pi rồi thử lại.';
  }
  if (code === 'unauthenticated') {
    return 'Bạn cần đăng nhập Google để sử dụng trợ lý AI.';
  }
  if (code === 'not-found') {
    return `Firebase Function askChatbot chưa được deploy ở vùng ${FUNCTIONS_REGION}.`;
  }
  if (code === 'failed-precondition') {
    return message || 'Firebase Function chưa được cấu hình đầy đủ; kiểm tra Secret GEMINI_API_KEY trên Firebase.';
  }
  if (code === 'deadline-exceeded') {
    return 'Firebase Function phản hồi quá thời gian chờ. Thử lại sau ít phút.';
  }
  if (code === 'invalid-argument') {
    return message || 'Câu hỏi hoặc lịch sử hội thoại không hợp lệ.';
  }
  if (code === 'internal') {
    return 'Firebase Function gặp lỗi nội bộ. Kiểm tra log của askChatbot trên Firebase.';
  }

  return message || 'Không gọi được Firebase Function askChatbot. Thử lại sau.';
}
