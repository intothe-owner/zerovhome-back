// src/models/MemberDevice.ts
import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';
import { Member } from './Member';

export class MemberDevice extends Model {}

MemberDevice.init({
  id: { 
    type: DataTypes.INTEGER, 
    autoIncrement: true, 
    primaryKey: true, 
    comment: '기기 고유 PK' 
  },
  memberId: { 
    type: DataTypes.INTEGER, 
    allowNull: false, 
    comment: '소유자 회원 ID (Member 테이블 참조)' 
  },
  deviceToken: { 
    type: DataTypes.STRING, 
    allowNull: false, 
    unique: true, 
    comment: 'FCM 등 푸시 서비스에서 발급받은 기기 토큰' 
  },
  deviceType: { 
    type: DataTypes.ENUM('WEB', 'ANDROID', 'IOS', 'ETC'), 
    defaultValue: 'ETC', 
    comment: '기기 환경 (웹, 안드로이드, iOS 등)' 
  },
  deviceId: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: '기기 고유 식별자 (동일 기기 토큰 중복 방지용)'
  },
  isPushActive: { 
    type: DataTypes.BOOLEAN, 
    defaultValue: true, 
    comment: '해당 기기의 푸시 알림 수신 동의 여부' 
  },
  lastUsedAt: { 
    type: DataTypes.DATE, 
    defaultValue: DataTypes.NOW, 
    comment: '마지막으로 토큰이 갱신되거나 사용된 시간 (안 쓰는 토큰 정리용)' 
  }
}, { 
  sequelize, 
  tableName: 'member_devices',
  comment: '회원별 푸시 알림 수신용 기기 토큰 테이블'
});