// src/config/firebase.ts
import { initializeApp, getApps, cert } from 'firebase-admin/app';

if (getApps().length === 0) {
  try {
    let serviceAccount;

    // 💡 1. 서버(도커) 환경: 환경 변수에 경로가 설정되어 있으면 그 외부 경로의 파일을 읽습니다.
    if (process.env.FIREBASE_KEY_PATH) {
      serviceAccount = require(process.env.FIREBASE_KEY_PATH);
    } 
    // 💡 2. 로컬 개발 환경: 환경 변수가 없으면 기존처럼 같은 폴더 안의 파일을 읽습니다.
    else {
      serviceAccount = require('./serviceAccountKey.json'); 
    }
    
    initializeApp({
      credential: cert(serviceAccount)
    });
    console.log('🔥 Firebase Admin SDK가 성공적으로 초기화되었습니다.');
  } catch (error) {
    console.error('❌ Firebase 초기화 중 에러 발생:', error);
  }
}