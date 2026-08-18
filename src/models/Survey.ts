import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { sequelize } from '../config/database';

export class Survey extends Model<InferAttributes<Survey>, InferCreationAttributes<Survey>> {
  declare id: CreationOptional<number>;
  declare title: string;
  declare intro: string | null;
  
  // 핵심: 관리자가 만든 문항과 보기를 JSON 배열로 통째로 저장합니다.
  // 예: [{ id: 1, type: "multiple", question: "만족하십니까?", options: ["매우만족", "만족"] }]
  declare questions: any; 
  
  declare isActive: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Survey.init({
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  intro: { type: DataTypes.TEXT, allowNull: true },
  questions: { 
    type: DataTypes.JSON, 
    allowNull: false, 
    comment: "설문 문항 및 보기 JSON 배열" 
  },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
  updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" },
}, {
  sequelize, tableName: "surveys", underscored: true
});