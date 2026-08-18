import {
    Model,
    DataTypes,
    InferAttributes,
    InferCreationAttributes,
    CreationOptional,
} from "sequelize";
import { sequelize } from '../config/database';

export type ListType = "SELECTED" | "WAITLIST";

export class CleanUpHousehold extends Model<
    InferAttributes<CleanUpHousehold>,
    InferCreationAttributes<CleanUpHousehold>
> {
    declare id: CreationOptional<number>;

    declare programYear: CreationOptional<number>;
    declare listType: ListType;

    declare localNo: number;
    declare categoryCode: number;

    declare dong: string;
    declare benefitType: string;

    declare name: string;
    declare rrn: string;
    declare phone: string | null;
    declare proxyPhone: string | null;

    declare roadAddress: string;
    declare detailAddress: string | null;

    declare rank: number;
    declare totalScore: number;

    declare scoreHouseholdSize: number | null;
    declare scoreAge: number | null;
    declare scoreDisability: number | null;
    declare scoreResidencePeriod: number | null;
    declare scoreBenefitType: number | null;
    declare scoreOther: number | null;

    declare otherReason: string | null;
    declare remark: string | null;

    declare addressImage: string | null;
    declare beforeImage: string | null;
    declare duringImage: string | null;
    declare afterImage: string | null;

    // 추가
    declare surveySignature: string | null;
    declare surveySubmittedAt: Date | null;
    declare surveySubmittedByName: string | null;
    // 좌표값 컬럼 추가
    declare latitude: number | null;  // 위도
    declare longitude: number | null; // 경도
    declare isArchived: CreationOptional<boolean> | false; // 추가
    declare routeOrder: number | 0; // 추가

    // --- 기존 WorkReport 테이블에서 흡수한 컬럼들 ---
    declare workerName: string | null;  // 작업자 명
    declare workDate: Date | null;      // 작업 일자
    declare reportMemo: string | null;  // 작업 메모
    declare pdfPath: string | null;     // 최종 생성된 PDF 경로
    declare isComplete: boolean | false;//완료
    declare isCancel: boolean | false;//취소
}

CleanUpHousehold.init(
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            autoIncrement: true,
            primaryKey: true,
            comment: "신청 ID",
        },

        programYear: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 2025,
            field: "program_year",
            comment: "사업연도",
        },

        listType: {
            type: DataTypes.ENUM("SELECTED", "WAITLIST"),
            allowNull: false,
            field: "list_type",
            comment: "선정/대기 구분",
        },

        localNo: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            field: "local_no",
            comment: "연번",
        },

        categoryCode: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            field: "category_code",
            comment: "구분 코드",
        },

        dong: {
            type: DataTypes.STRING(30),
            allowNull: false,
            comment: "동별",
        },

        benefitType: {
            type: DataTypes.STRING(120),
            allowNull: false,
            field: "benefit_type",
            comment: "수급형태",
        },

        name: {
            type: DataTypes.STRING(50),
            allowNull: false,
            comment: "성명",
        },

        rrn: {
            type: DataTypes.STRING(20),
            allowNull: false,
            comment: "주민등록번호",
        },

        phone: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: "핸드폰번호",
        },

        proxyPhone: {
            type: DataTypes.STRING(255),
            allowNull: true,
            field: "proxy_phone",
            comment: "대리인 연락처",
        },

        roadAddress: {
            type: DataTypes.STRING(255),
            allowNull: false,
            field: "road_address",
            comment: "도로명주소",
        },

        detailAddress: {
            type: DataTypes.STRING(255),
            allowNull: true,
            field: "detail_address",
            comment: "상세주소",
        },

        rank: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: "순위",
        },

        totalScore: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            field: "total_score",
            comment: "총점",
        },

        scoreHouseholdSize: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            field: "score_household_size",
            comment: "세대원수 점수",
        },

        scoreAge: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            field: "score_age",
            comment: "연령 점수",
        },

        scoreDisability: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            field: "score_disability",
            comment: "장애유무 점수",
        },

        scoreResidencePeriod: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            field: "score_residence_period",
            comment: "거주기간 점수",
        },

        scoreBenefitType: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            field: "score_benefit_type",
            comment: "수급형태 점수",
        },

        scoreOther: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            field: "score_other",
            comment: "기타 점수",
        },

        otherReason: {
            type: DataTypes.TEXT("long"),
            allowNull: true,
            field: "other_reason",
            comment: "기타 사유",
        },

        remark: {
            type: DataTypes.TEXT("long"),
            allowNull: true,
            comment: "비고",
        },

        addressImage: {
            type: DataTypes.STRING(500),
            allowNull: true,
            field: "address_image",
            comment: "주소 사진",
        },

        beforeImage: {
            type: DataTypes.STRING(500),
            allowNull: true,
            field: "before_image",
            comment: "작업전 사진",
        },

        duringImage: {
            type: DataTypes.STRING(500),
            allowNull: true,
            field: "during_image",
            comment: "작업중 사진",
        },

        afterImage: {
            type: DataTypes.STRING(500),
            allowNull: true,
            field: "after_image",
            comment: "작업후 사진",
        },

        surveySignature: {
            type: DataTypes.STRING(500),
            allowNull: true,
            field: "survey_signature",
            comment: "설문 서명 이미지 경로",
        },

        surveySubmittedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            field: "survey_submitted_at",
            comment: "설문 제출일시",
        },

        surveySubmittedByName: {
            type: DataTypes.STRING(100),
            allowNull: true,
            field: "survey_submitted_by_name",
            comment: "설문 제출 성명",
        },
        // 위도 추가
        latitude: {
            type: DataTypes.DECIMAL(10, 8),
            allowNull: true,
            comment: "위도",
        },
        // 경도 추가
        longitude: {
            type: DataTypes.DECIMAL(11, 8),
            allowNull: true,
            comment: "경도",
        },
        workerName: { type: DataTypes.STRING(100), allowNull: true, field: "worker_name" },
        workDate: { type: DataTypes.DATEONLY, allowNull: true, field: "work_date" },
        reportMemo: { type: DataTypes.TEXT, allowNull: true, field: "report_memo" },
        pdfPath: { type: DataTypes.STRING(500), allowNull: true, field: "pdf_path" },
        isArchived: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            field: "is_archived",
            comment: "보관함 이동 여부",
        },
        routeOrder: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            field: "route_order", // DB 컬럼명
        },
        isComplete: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            field: "is_complete",
            comment: "작업완료여부",
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
        tableName: "clean_up_households",
        timestamps: true,
        underscored: true,
        comment: "2025 냉방기 클린UP 신청 가구",
        indexes: [
            {
                name: "uq_clean_up_households_year_list_type_local_no",
                unique: true,
                fields: ["program_year", "list_type", "local_no"],
            },
            { name: "idx_clean_up_households_list_type_rank", fields: ["list_type", "rank"] },
            { name: "idx_clean_up_households_dong", fields: ["dong"] },
            { name: "idx_clean_up_households_total_score", fields: ["total_score"] },
            { name: "idx_clean_up_households_created_at", fields: ["created_at"] },
            { name: "idx_clean_up_households_survey_submitted_at", fields: ["survey_submitted_at"] },
        ],
    }
);