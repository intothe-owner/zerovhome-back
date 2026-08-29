import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { sequelize } from "../config/database";

export class SiteReportForm extends Model<InferAttributes<SiteReportForm>, InferCreationAttributes<SiteReportForm>> {
  declare id: CreationOptional<number>;
  declare workSiteId: number; 
  
  // 💡 카테고리 항목 추가 (예: ["에어컨", "공기청정기"])
  declare categories: any; 
  declare textFields: any; 
  declare imageFields: any; 

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SiteReportForm.init({
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  workSiteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "work_site_id" },
  categories: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: ["기본"],
    comment: "기기/작업 카테고리 배열 (JSON)"
  },
  textFields: { 
    type: DataTypes.JSON, 
    allowNull: false, 
    comment: "텍스트 입력 항목 배열 (JSON)" 
  },
  imageFields: { 
    type: DataTypes.JSON, 
    allowNull: false, 
    comment: "사진 입력 항목 배열 (JSON)" 
  },
  createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
  updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" },
}, {
  sequelize, tableName: "site_report_forms", underscored: true
});