import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute // 💡 1. NonAttribute 추가
} from "sequelize";
import { sequelize } from "../config/database";
import { WorkItem } from "./WorkItem"; // 💡 2. 연결될 WorkItem 모델 임포트

export class SiteReportResult extends Model<InferAttributes<SiteReportResult>, InferCreationAttributes<SiteReportResult>> {
  declare id: CreationOptional<number>;
  declare workItemId: number; // 엑셀 행 데이터(개별 작업 건) ID
  declare workerId: number; // 작성한 담당자(회원) ID

  // 💡 3. 조인(include) 시 데이터가 담길 관계 속성 선언
  declare workItem?: NonAttribute<WorkItem>;

  // 💡 작성된 텍스트 데이터 (Key-Value)
  declare textAnswers: any;

  // 💡 업로드된 사진 URL 데이터 (Key-Value)
  declare imageAnswers: any;

  // 💡 A4 규격으로 생성된 최종 PDF 파일 경로
  declare pdfPath: string | null;

  declare submittedAt: CreationOptional<Date>;
}

SiteReportResult.init({
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  workItemId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: "work_item_id" },
  workerId: {
    type: DataTypes.INTEGER, // 💡 반드시 UNSIGNED를 붙여서 members 테이블의 id와 타입을 일치시켜야 합니다.
    allowNull: false,
    field: "worker_id",
    comment: "작성자(회원) ID"
  },
  textAnswers: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: "입력된 텍스트 결과 (JSON)"
  },
  imageAnswers: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: "업로드된 사진 URL 결과 (JSON)"
  },
  pdfPath: {
    type: DataTypes.STRING(500),
    allowNull: true,
    field: "pdf_path",
    comment: "A4 변환 완료된 PDF 저장 경로"
  },
  submittedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: "submitted_at" },
}, {
  sequelize, tableName: "site_report_results", underscored: true
});