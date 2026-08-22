import { 
  Model, 
  DataTypes, 
  InferAttributes, 
  InferCreationAttributes, 
  CreationOptional 
} from 'sequelize';
import { sequelize } from '../config/database';

export class Reservation extends Model<
  InferAttributes<Reservation>,
  InferCreationAttributes<Reservation>
> {
  declare id: CreationOptional<number>;
  declare category1Id: number;
  declare category2Id: number;
  
  declare unitCount: number;
  declare totalPrice: number;
  
  declare customerName: string;
  declare customerPhone: string;
  declare address: string;
  declare detailAddress: string | null;
  
  declare reservationDate: string; 
  declare reservationTime: string; 
  
  declare status: CreationOptional<'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'>;
  
  declare workerId: number | null; 
  
  declare privacyAgreed: boolean;
  
  // 💡 문제가 되었던 createdAt, updatedAt 선언부 삭제 완료
}

Reservation.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  category1Id: { type: DataTypes.INTEGER, allowNull: false, comment: '1차 카테고리' },
  category2Id: { type: DataTypes.INTEGER, allowNull: false, comment: '2차 카테고리' },
  
  unitCount: { type: DataTypes.INTEGER, allowNull: false, comment: '입력한 수치 (평수/대수 등)' },
  totalPrice: { type: DataTypes.INTEGER, allowNull: false, comment: '자동 계산된 최종 견적가' },
  
  customerName: { type: DataTypes.STRING, allowNull: false, comment: '신청자 이름' },
  customerPhone: { type: DataTypes.STRING, allowNull: false, comment: '신청자 연락처' },
  address: { type: DataTypes.STRING, allowNull: false, comment: '방문 주소' },
  detailAddress: { type: DataTypes.STRING, allowNull: true, comment: '상세 주소' },
  
  reservationDate: { type: DataTypes.DATEONLY, allowNull: false, comment: '예약 날짜' },
  reservationTime: { type: DataTypes.TIME, allowNull: false, comment: '예약 시간' },
  
  status: { 
    type: DataTypes.ENUM('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'), 
    defaultValue: 'PENDING', 
    comment: '예약 상태' 
  },
  workerId: { type: DataTypes.INTEGER, allowNull: true, comment: '배정된 직원(Member) ID' },
  
  privacyAgreed: { type: DataTypes.BOOLEAN, allowNull: false, comment: '개인정보취급방침 동의 여부' }
}, {
  sequelize,
  tableName: 'reservations',
  timestamps: true, // 💡 Sequelize가 생성/수정 시간을 자동 관리하도록 설정
  indexes: [
    {
      name: 'uq_reservation_date_time',
      unique: true,
      fields: ['reservationDate', 'reservationTime']
    }
  ],
  comment: '예약 및 견적 신청 내역'
});