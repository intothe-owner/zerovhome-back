import { 
  Model, 
  DataTypes, 
  InferAttributes, 
  InferCreationAttributes, 
  CreationOptional 
} from 'sequelize';
import { sequelize } from '../config/database';

export class ServicePrice extends Model<
  InferAttributes<ServicePrice>,
  InferCreationAttributes<ServicePrice>
> {
  // TypeScript 에러 방지용 명시적 선언
  declare id: CreationOptional<number>;
  declare categoryId: number;
  declare unitType: 'PYUNG' | 'SQM' | 'DEVICE' | 'FIXED';
  declare unitPrice: number;
  declare basePrice: CreationOptional<number>;
}

ServicePrice.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  categoryId: { type: DataTypes.INTEGER, allowNull: false, comment: '연결된 카테고리 ID' },
  unitType: { 
    type: DataTypes.ENUM('PYUNG', 'SQM', 'DEVICE', 'FIXED'), 
    allowNull: false, 
    comment: '단위 타입 (PYUNG: 평수, SQM: 제곱미터, DEVICE: 기기대수, FIXED: 고정가)' 
  },
  unitPrice: { type: DataTypes.INTEGER, allowNull: false, comment: '1단위당 가격' },
  basePrice: { type: DataTypes.INTEGER, defaultValue: 0, comment: '기본 출장비/기본요금' }
}, {
  sequelize,
  tableName: 'service_prices',
  timestamps: false, // 요금 테이블은 생성/수정 시간이 굳이 필요하지 않아 제외했습니다.
  comment: '카테고리별 요금 설정 테이블'
});