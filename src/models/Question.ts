import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class Question extends Model {}
Question.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, comment: '문제 고유 PK' },
  examTitle: { type: DataTypes.STRING, allowNull: false, comment: '시험 회차명 (예: 전기기능사 1회)' },
  questionNumber: { type: DataTypes.INTEGER, allowNull: true, comment: '문제 번호' },
  content: { type: DataTypes.TEXT, allowNull: false, comment: '문제 본문 내용' },
  options: { type: DataTypes.JSON, allowNull: false, comment: '보기 배열 (JSON 텍스트)' },
  answer: { type: DataTypes.INTEGER, allowNull: false, comment: '정답 인덱스 (0~3)' },
  explanation: { type: DataTypes.TEXT, allowNull: true, comment: '문제 해설' },
  imageUrl: { type: DataTypes.STRING, allowNull: true, comment: '문제 첨부 이미지 URL (필요 시)' }
}, { 
  sequelize, 
  tableName: 'questions',
  paranoid: true, // 문제 오류 등으로 삭제 처리할 경우 대비
  comment: 'CBT 시험 문제 데이터 테이블' 
});