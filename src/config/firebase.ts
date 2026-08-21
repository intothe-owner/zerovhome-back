// src/config/firebase.ts
import { initializeApp, getApps, cert } from 'firebase-admin/app';

// ✨ admin.apps.length 대신 getApps().length 를 사용합니다.
if (getApps().length === 0) {
  try {
    const serviceAccount = require('./serviceAccountKey.json'); 
    
    initializeApp({
      credential: cert(serviceAccount) 
    });
    console.log('🔥 Firebase Admin SDK가 성공적으로 초기화되었습니다.');
  } catch (error) {
    console.error('❌ Firebase 초기화 중 에러 발생:', error); 
  }
} 