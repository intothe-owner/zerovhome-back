import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { sequelize } from "../config/database";

export class WorkSite extends Model<InferAttributes<WorkSite>, InferCreationAttributes<WorkSite>> {
  declare id: CreationOptional<number>;
  declare title: string; // 현장명
  declare description: string | null;
  
  declare excelHeaders: any | null; // 엑셀에서 추출한 전체 컬럼명 (배열)
  
  // 💡 [요구사항 6] 목록/상세 화면 노출 항목 설정
  declare listVisibleFields: any; // 목록 화면에 보여줄 컬럼명 배열 (JSON)
  declare detailVisibleFields: any; // 상세 화면에 보여줄 컬럼명 배열 (JSON)
  
  declare hasSurvey: CreationOptional<boolean>; // 설문조사 진행 여부

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

WorkSite.init({
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  title: { type: DataTypes.STRING(255), allowNull: false, comment: "작업 현장명" },
  description: { type: DataTypes.TEXT, allowNull: true, comment: "현장 설명" },
  
  excelHeaders: { type: DataTypes.JSON, allowNull: true, comment: "엑셀 전체 컬럼명" },
  listVisibleFields: { 
    type: DataTypes.JSON, 
    allowNull: true, 
    field: "list_visible_fields",
    comment: "목록에 노출할 항목 배열 (예: ['고객명', '연락처'])" 
  },
  detailVisibleFields: { 
    type: DataTypes.JSON, 
    allowNull: true, 
    field: "detail_visible_fields",
    comment: "상세에 노출할 항목 배열 (예: ['고객명', '주소', '면적'])" 
  },
  
  hasSurvey: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "has_survey", comment: "설문조사 진행 여부" },
  createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
  updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" },
}, {
  sequelize, tableName: "work_sites", underscored: true
});