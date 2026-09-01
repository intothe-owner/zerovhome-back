// models/UserAnswer.ts
import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class UserAnswer extends Model {}
UserAnswer.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  sessionId: { type: DataTypes.INTEGER, allowNull: false, comment: '소속된 응시 세션 ID' },
  questionId: { type: DataTypes.INTEGER, allowNull: false, comment: '풀이한 문제 ID' },
  submittedAnswer: { type: DataTypes.INTEGER, allowNull: true, comment: '선택한 답 인덱스' },
  
  // ▼▼▼ 새롭게 추가되는 2개의 필드 ▼▼▼
  shuffledOptions: { type: DataTypes.JSON, allowNull: true, comment: '사용자가 푼 당시의 섞인 보기 배열' },
  correctAnswer: { type: DataTypes.INTEGER, allowNull: true, comment: '섞인 보기 기준 실제 정답 인덱스' },
  
  isCorrect: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, { 
  sequelize, 
  tableName: 'user_answers'
});