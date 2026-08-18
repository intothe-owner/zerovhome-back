import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { sequelize } from '../config/database';

export class SurveyResponse extends Model<InferAttributes<SurveyResponse>, InferCreationAttributes<SurveyResponse>> {
  declare id: CreationOptional<number>;
  declare surveyId: number;
  declare householdId: number;
  declare respondentName: string;
  
  // 핵심: 사용자가 선택한 답변들을 JSON으로 저장합니다.
  // 예: { "1": "매우만족", "2": "친절해서 좋았습니다" }
  declare answers: any; 
  
  declare signaturePath: string | null;
  declare submittedAt: CreationOptional<Date>;
}

SurveyResponse.init({
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  surveyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "survey_id" },
  householdId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "household_id" },
  respondentName: { type: DataTypes.STRING(100), allowNull: false },
  answers: { 
    type: DataTypes.JSON, 
    allowNull: false, 
    comment: "문항별 응답 데이터 JSON" 
  },
  signaturePath: { type: DataTypes.STRING(500), allowNull: true },
  submittedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  sequelize, tableName: "survey_responses", underscored: true
});