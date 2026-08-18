import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { sequelize } from "../config/database";

export class SeniorCenterCleanUp extends Model<
  InferAttributes<SeniorCenterCleanUp>,
  InferCreationAttributes<SeniorCenterCleanUp>
> {
  declare id: CreationOptional<number>;
  declare programYear: CreationOptional<number>; // 사업연도 (예: 2026) 
  
  declare seq: number; // 연번 
  declare name: string; // 경로당 명 
  declare dong: string; // 동명 
  declare roadAddress: string; // 소재지 도로명주소 
  
  declare managerName: string | null; // 담당자 
  declare managerPhone: string | null; // 연락처 
  declare centerPhone: string | null; // 경로당 연락처 
  
  declare facilityType: string | null; // 시설 유형 (아파트, 주택 등) 
  declare area: number | null; // 면적(㎡) 

  // 에어컨 설치현황 
  declare acCeilingCount: number | 0; // 에어컨 천장형 
  declare acStandCount: number | 0; // 에어컨 스탠드 
  declare acWallCount: number | 0; // 에어컨 벽걸이 
  
  // 공기청정기 설치현황 
  declare airPurifierCount: number | 0; // 공기청정기 
  declare workName: string | null;
  declare workDate: Date | null; // 작업일자 
  declare remark: string | null; // 비고 

  // 관리용 컬럼 (CleanUpHousehold.ts 스타일 참고) 
  declare latitude: number | null; // 위도 
  declare longitude: number | null; // 경도 
  declare routeOrder: CreationOptional<number>; // 경로 순서 
  declare acReportImages: any | null;       // 에어컨 관련 작업 사진들
  declare purifierReportImages: any | null; // 공기청정기 관련 작업 사진들
  
  declare pdfPath: string | null; // 생성된 PDF 경로
  declare isComplete: boolean | false; // 작업 완료 여부 
  declare isArchive: boolean | false; // 보관함 이동 여부 
  declare isCancel: boolean | false;//취소여부
}

SeniorCenterCleanUp.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    programYear: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 2026,
      field: "program_year",
    },
    seq: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "연번",
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "경로당 명",
    },
    dong: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: "동명",
    },
    roadAddress: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "road_address",
      comment: "소재지 도로명주소",
    },
    managerName: {
      type: DataTypes.STRING(50),
      field: "manager_name",
      comment: "담당자",
    },
    managerPhone: {
      type: DataTypes.STRING(50),
      field: "manager_phone",
      comment: "연락처",
    },
    centerPhone: {
      type: DataTypes.STRING(50),
      field: "center_phone",
      comment: "경로당 연락처",
    },
    facilityType: {
      type: DataTypes.STRING(50),
      field: "facility_type",
      comment: "시설 유형",
    },
    area: {
      type: DataTypes.DECIMAL(10, 3),
      comment: "면적(㎡)",
    },
    acCeilingCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: "ac_ceiling_count",
      comment: "에어컨 천장형",
    },
    acStandCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: "ac_stand_count",
      comment: "에어컨 스탠드",
    },
    acWallCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: "ac_wall_count",
      comment: "에어컨 벽걸이",
    },
    airPurifierCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: "air_purifier_count",
      comment: "공기청정기",
    },
    workName: {
      type: DataTypes.STRING(50),
      field: "work_name",
      allowNull: true,
      comment: "시설 유형",
    },
    workDate: {
      type: DataTypes.DATEONLY,
      field: "work_date",
      comment: "작업일자",
    },
    remark: {
      type: DataTypes.TEXT,
      comment: "비고",
    },
    latitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: true,
      comment: "위도",
    },
    longitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: true,
      comment: "경도",
    },
    routeOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "route_order",
    },
    // ... 기존 컬럼 매핑 생략 (유지) ...
  acReportImages: { 
    type: DataTypes.JSON, 
    allowNull: true, 
    comment: "에어컨 작업 관련 사진 URL 모음 (JSON)" 
  },
  purifierReportImages: { 
    type: DataTypes.JSON, 
    allowNull: true, 
    comment: "공기청정기 작업 관련 사진 URL 모음 (JSON)" 
  },
  pdfPath: { type: DataTypes.STRING(500), allowNull: true, field: "pdf_path" },
    isComplete: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_complete",
    },
    isArchive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_archived",
    },
    isCancel: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_cancel",
      comment: "취소여부",
    },
  },
  {
    sequelize,
    tableName: "senior_center_clean_ups",
    timestamps: true,
    underscored: true,
    comment: "2026 경로당 에어컨 및 공기청정기 세척 작업 명단",
  }
);