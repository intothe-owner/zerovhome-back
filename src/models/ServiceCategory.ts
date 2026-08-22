import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class ServiceCategory extends Model {}

ServiceCategory.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, comment: '카테고리 고유 PK' },
  name: { type: DataTypes.STRING, allowNull: false, comment: '카테고리명 (예: 에어컨청소, 벽걸이형)' },
  parentId: { type: DataTypes.INTEGER, allowNull: true, comment: '상위 카테고리 ID (null이면 1차 카테고리)' },
  depth: { type: DataTypes.INTEGER, defaultValue: 1, comment: '카테고리 뎁스 (1, 2)' },
  order: { type: DataTypes.INTEGER, defaultValue: 0, comment: '노출 순서' },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true, comment: '사용 여부' }
}, {
  sequelize,
  tableName: 'service_categories',
  paranoid: true, // 논리 삭제 활성화
  comment: '1차/2차 서비스 카테고리' 
}); 