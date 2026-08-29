import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { sequelize } from "../config/database";

export class WorkItem extends Model<InferAttributes<WorkItem>, InferCreationAttributes<WorkItem>> {
  declare id: CreationOptional<number>;
  declare workSiteId: number;
  declare assignedMemberId: number | null; // 배정된 회원(작업자) ID
  
  declare customerName: string; // 고객명
  declare rowData: any; // 엑셀 업로드 원본 데이터 (JSON)

  // 💡 [요구사항 5] 카카오 내비 연동을 위한 위도, 경도 좌표
  declare latitude: number | null;  // 위도[cite: 1, 5]
  declare longitude: number | null; // 경도[cite: 1, 5]

  // 💡 [요구사항 5] 작업 순서 (낮을수록 우선 정렬)
  declare routeOrder: CreationOptional<number>; //[cite: 1]

  // 작업 상태 (대기, 작업중, 작업완료, 취소)
  declare status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
  
  // 작업 완료 후 입력되는 정보 및 고객 서명
  declare workDate: Date | null;          // 작업 완료일자
  declare workerName: string | null;      // 작업자 이름
  declare customerSignature: string | null; // 고객 서명 이미지 경로

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

WorkItem.init({
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  workSiteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "work_site_id" },
  assignedMemberId: { type: DataTypes.INTEGER, allowNull: true, field: "assigned_member_id", comment: "배정된 회원 ID" },
  
  customerName: { 
    type: DataTypes.STRING(100), 
    allowNull: false, 
    field: "customer_name",
    comment: "고객명" 
  },
  
  rowData: { type: DataTypes.JSON, allowNull: false, comment: "엑셀 업로드 원본 데이터 (JSON)" },
  
  latitude: { 
    type: DataTypes.DECIMAL(11, 8), 
    allowNull: true, 
    comment: "위도 (카카오내비 연동용)" //[cite: 1, 5]
  },
  longitude: { 
    type: DataTypes.DECIMAL(11, 8), 
    allowNull: true, 
    comment: "경도 (카카오내비 연동용)" //[cite: 1, 5]
  },
  routeOrder: { 
    type: DataTypes.INTEGER, 
    allowNull: false, 
    defaultValue: 0, 
    field: "route_order",
    comment: "작업 순서 (낮을수록 우선 순위)" //[cite: 1]
  },

  status: { 
    type: DataTypes.ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'), 
    allowNull: false,
    defaultValue: 'PENDING',
    comment: "작업 상태 (대기, 작업중, 완료, 취소)" 
  },
  
  workDate: { type: DataTypes.DATEONLY, allowNull: true, field: "work_date", comment: "작업 완료일자" },
  workerName: { type: DataTypes.STRING(100), allowNull: true, field: "worker_name", comment: "작업자 성명" },
  customerSignature: { type: DataTypes.STRING(500), allowNull: true, field: "customer_signature", comment: "고객 서명 이미지 경로" },

  createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
  updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" },
}, {
  sequelize, tableName: "work_items", underscored: true,
  indexes: [
    { name: "idx_work_items_customer_name", fields: ["customer_name"] },
    { name: "idx_work_items_status", fields: ["status"] },
    { name: "idx_work_items_route_order", fields: ["route_order"] }
  ]
});