import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { sequelize } from './config/database';
import './models/'; // 모델 임포트
import settingRoutes from './routes/settingRoutes';
import memberSettingRoutes from './routes/memberSettingRoutes';
import menuRoutes from './routes/menuRoutes';
import pageRoutes from './routes/pageRoutes';
import boardConfigRoutes from './routes/boardConfigRoutes';
import aiRoutes from './routes/aiRoutes';
import boardRoutes from './routes/boardRoutes';
import authRoutes from './routes/authRoutes';
import popupRoutes from './routes/popupRoutes';
import visitorRoutes from './routes/visitorRoutes';
import memberRoutes from './routes/memberRoutes';
import supportFundRoutes from './routes/supportFundRoutes';
import households from "./routes/households";
import importRouter from "./routes/import";
import seniorCenterImport from "./routes/seniorCenterImport";
import surveyRouter from "./routes/survey";
import WorkReportRouter from "./routes/workReports";
import seniorCenters from "./routes/seniorCenters";
import seniorReports from "./routes/seniorReports";
import path from 'path';
import './config/firebase';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// 💡 1. CORS 설정을 가장 최상단으로 이동 (모든 요청에 대해 CORS 허용)
const corsOptions: cors.CorsOptions = {
  origin: [
    "http://localhost:3000",
    "http://113.131.151.103:3000",
    "http://www.zerov.co.kr",
    "http://zerov.co.kr",
    // "http://113.131.151.103:8088",
    // "http://www.syconsulting.co.kr",
    // "http://syconsulting.co.kr",
    // "https://www.syconsulting.co.kr",
    // "https://syconsulting.co.kr", 
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
};
console.log(process.env.GEMINI_API_KEY);
app.use(cors(corsOptions));

// 💡 2. Body Parser 설정
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 💡 3. 정적 파일 제공 (CORS와 Body 파싱이 적용된 후 실행)
app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

// 4. API 라우터 연결
app.use('/api/settings', settingRoutes);
app.use('/api/member-settings', memberSettingRoutes);
app.use('/api/menus', menuRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/board-configs', boardConfigRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/boards', boardRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/popups', popupRoutes);
app.use('/api/funds', supportFundRoutes);
app.use('/api/visitors', visitorRoutes);
app.use('/api/members', memberRoutes);
app.use("/api/households", households);
app.use("/api/import", importRouter);
app.use("/api/senior-import", seniorCenterImport);
app.use("/api/survey", surveyRouter);
app.use("/api/work-reports", WorkReportRouter);
app.use("/api/senior", seniorCenters);
app.use("/api/senior-centers", seniorReports);

// app.ts 의 모든 라우터(app.use) 설정들 맨 아래에 추가하세요.
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('🚨 [전역 에러 캐치] 숨겨진 에러 발생:', {
    message: err.message,
    name: err.name,
    type: err.type,
    status: err.status,
  });
  
  res.status(err.status || 500).json({ 
    success: false, 
    message: err.message || '서버 전역 에러' 
  });
});
// DB 동기화 및 서버 실행
sequelize.sync({ alter: true }) // alter: true는 스키마 변경 시 테이블을 자동으로 수정해 줍니다.
  .then(() => {
    console.log('✅ 데이터베이스 연결 및 테이블 동기화 완료');
    app.listen(PORT, () => {
      console.log(`🚀 Node.js Backend Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('❌ 데이터베이스 연결 실패:', error);
  });