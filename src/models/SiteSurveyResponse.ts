import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from "sequelize";
import { sequelize } from "../config/database";

export class SiteSurveyResponse extends Model<InferAttributes<SiteSurveyResponse>, InferCreationAttributes<SiteSurveyResponse>> {
  declare id: CreationOptional<number>;
  declare workItemId: number; // 엑셀의 각 행 데이터(개별 작업)와 연결
  declare siteSurveyId: number; // 어떤 설문 폼에 대한 응답인지 연결
  
  // 💡 핵심: 사용자가 선택/작성한 답변을 JSON으로 저장
  /* 저장 예시:
    { "1": "매우 만족", "2": "시간을 잘 지켜주셔서 감사합니다." }
  */
  declare answers: any; 

  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SiteSurveyResponse.init({
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  workItemId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "work_item_id", comment: "개별 작업 목록 ID" },
  siteSurveyId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "site_survey_id", comment: "현장 설문조사 마스터 ID" },
  answers: { 
    type: DataTypes.JSON, 
    allowNull: false, 
    comment: "문항별 사용자 응답 데이터 JSON" //[cite: 3]
  },
  createdAt: { type: DataTypes.DATE, allowNull: false, field: "created_at" },
  updatedAt: { type: DataTypes.DATE, allowNull: false, field: "updated_at" },
}, {
  sequelize, tableName: "site_survey_responses", underscored: true
});