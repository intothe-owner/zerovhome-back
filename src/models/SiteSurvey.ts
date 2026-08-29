import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { sequelize } from "../config/database";

export class SiteSurvey extends Model<InferAttributes<SiteSurvey>, InferCreationAttributes<SiteSurvey>> {
  declare id: CreationOptional<number>;
  declare workSiteId: number;
  declare title: string;          // 💡 설문 타이틀 추가
  declare description: string | null; // 💡 설문 내용/설명 추가
  declare questions: any; 

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SiteSurvey.init({
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  workSiteId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "work_site_id" },
  title: { type: DataTypes.STRING(255), allowNull: false, defaultValue: "만족도 조사", comment: "설문 제목" },
  description: { type: DataTypes.TEXT, allowNull: true, comment: "설문 안내 문구 및 내용" },
  questions: { 
    type: DataTypes.JSON, 
    allowNull: false, 
    comment: "객관식/주관식 설문 문항 및 보기 JSON 배열" 
  },
  createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
  updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" },
}, {
  sequelize, tableName: "site_surveys", underscored: true
});