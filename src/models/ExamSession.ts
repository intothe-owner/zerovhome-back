import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class ExamSession extends Model {}
ExamSession.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, comment: '응시 기록 고유 PK' },
  examTitle: { type: DataTypes.STRING, allowNull: false, comment: '응시 중인 시험명 (예: 랜덤 모의고사)' },
  totalScore: { type: DataTypes.INTEGER, defaultValue: 0, comment: '최종 획득 점수' },
  isCompleted: { type: DataTypes.BOOLEAN, defaultValue: false, comment: '시험 최종 제출(완료) 여부' },
  startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, comment: '시험 시작 시간' },
  completedAt: { type: DataTypes.DATE, allowNull: true, comment: '시험 종료/제출 시간' }
}, { 
  sequelize, 
  tableName: 'exam_sessions',
  comment: '개인 CBT 응시 이력 테이블' 
});