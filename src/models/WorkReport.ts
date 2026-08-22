import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class WorkReport extends Model {}

WorkReport.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  reservationId: { type: DataTypes.INTEGER, allowNull: false, comment: '연결된 예약 ID' },
  
  // 보고서 텍스트 정보
  customerName: { type: DataTypes.STRING, allowNull: false, comment: '고객명' },
  companyName: { type: DataTypes.STRING, allowNull: true, comment: '회사명(법인일 경우)' },
  projectName: { type: DataTypes.STRING, allowNull: false, comment: '공사/작업명' },
  address: { type: DataTypes.STRING, allowNull: false, comment: '작업 주소' },
  workDate: { type: DataTypes.DATEONLY, allowNull: false, comment: '실제 작업일자' },
  workerName: { type: DataTypes.STRING, allowNull: false, comment: '작업자명' },
  representativeName: { type: DataTypes.STRING, allowNull: true, comment: '대표자명' },
  
  // 📸 증빙 사진 경로 (S3 등 스토리지 URL)
  addressImage: { type: DataTypes.STRING(500), allowNull: true, comment: '현장 주소(외관) 사진' },
  progressImage: { type: DataTypes.STRING(500), allowNull: true, comment: '작업 진행 사진' },
  beforeImage1: { type: DataTypes.STRING(500), allowNull: true, comment: '작업 전 사진 1' },
  afterImage1: { type: DataTypes.STRING(500), allowNull: true, comment: '작업 후 사진 1' },
  beforeImage2: { type: DataTypes.STRING(500), allowNull: true, comment: '작업 전 사진 2' },
  afterImage2: { type: DataTypes.STRING(500), allowNull: true, comment: '작업 후 사진 2' },
}, {
  sequelize,
  tableName: 'work_reports',
  comment: '관리자/작업자 작업 완료 보고서'
});