import { Router, Request, Response } from "express";
import multer from "multer";
import XLSX from "xlsx";
import { Transaction } from "sequelize";
import { sequelize } from "../db/sequelize";
import { CleanUpHousehold, ListType } from "../models/CleanUpHousehold";
import { getCoordsByAddress } from "../utils/geocoder";

const router = Router();

/**
 * multer 설정
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const lower = file.originalname.toLowerCase();
    const isExcel =
      lower.endsWith(".xls") ||
      lower.endsWith(".xlsx") ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.mimetype ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.mimetype === "application/octet-stream";

    if (!isExcel) {
      return cb(new Error("엑셀(.xls, .xlsx) 파일만 업로드할 수 있습니다."));
    }

    cb(null, true);
  },
});

type UploadBody = {
  programYear?: string;
  listType?: ListType;
  overwrite?: string;
};

type JsonRow = Record<string, unknown>;

type ParsedRow = {
  programYear: number;
  listType: ListType;
  localNo: number;
  categoryCode: number;
  dong: string;
  benefitType: string;
  name: string;
  rrn: string;
  phone: string | null;
  proxyPhone: string | null;
  roadAddress: string;
  detailAddress: string | null;
  latitude: number | null;  // 추가
  longitude: number | null; // 추가
  rank: number;
  totalScore: number;
  scoreHouseholdSize: number | null;
  scoreAge: number | null;
  scoreDisability: number | null;
  scoreResidencePeriod: number | null;
  scoreBenefitType: number | null;
  scoreOther: number | null;
  otherReason: string | null;
  remark: string | null;
  airconType: string | null; // 현재 모델에는 없음. 필요 시 모델 추가
  isArchived: boolean | false;
  isCancel: boolean | false;
  routeOrder: number | 0;
  isComplete: boolean | false;
};

/**
 * 헤더 정규화
 */
function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, "")
    .replace(/\*/g, "")
    .trim()
    .toLowerCase();
}

/**
 * 문자열 정리
 */
function cleanString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nullableString(value: unknown): string | null {
  const s = cleanString(value);
  return s === "" ? null : s;
}

/**
 * 숫자 변환
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const raw = String(value).replace(/,/g, "").trim();
  if (!raw) return null;

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * 주민번호/전화번호 등 문자열 보존
 */
function toSafeText(value: unknown): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "number") {
    return value.toLocaleString("fullwide", { useGrouping: false }).trim();
  }

  return String(value).trim();
}

/**
 * 실제 업로드 파일 기준 헤더 alias
 */
const HEADER_ALIASES: Record<
  keyof Omit<ParsedRow, "programYear" | "listType" | "latitude" | "longitude" | "isArchived" | "routeOrder" | "isComplete" | "isCancel">,
  string[]
> = {
  localNo: [
    "연번",
    "번호",
    "no",
    "순번",
    "접수번호",
    "구분",
  ],

  categoryCode: [
    "구분",
    "구분코드",
    "유형",
    "카테고리",
  ],

  dong: [
    "동명",
    "동별",
    "동",
    "행정동",
  ],

  benefitType: [
    "자격형태",
    "자격형태(행복이음확인)보장정확히기재",
    "자격형태(행복이음 확인) 보장 정확히 기재",
    "수급형태",
    "급여형태",
  ],

  name: [
    "성명",
    "이름",
    "* 성명",
    "*성명",
  ],

  rrn: [
    "주민등록번호",
    "주민번호",
    "생년월일/주민번호",
    "생년월일",
    "* 주민등록번호",
    "*주민등록번호",
  ],

  phone: [
    "휴대폰번호",
    "핸드폰번호",
    "전화번호",
    "연락처",
    "핸드폰",
    "휴대폰",
  ],

  proxyPhone: [
    "대리인 등번호",
    "대리인연락처",
    "대리인번호",
    "대리인핸드폰",
    "대리인휴대폰",
    "대리인등연락처",
  ],

  roadAddress: [
    "도로명주소",
    "주소",
    "거주주소",
  ],

  detailAddress: [
    "상세주소",
    "주소상세",
  ],

  rank: [
    "순위",
    "우선순위",
    "랭크",
  ],

  totalScore: [
    "총점",
    "총점수",
    "합계",
    "* 총점",
    "*총점",
  ],

  scoreHouseholdSize: [
    "세대원수",
    "세대원수(25점)",
    "세대원수(20점)",
    "세대원수점수",
  ],

  scoreAge: [
    "연령",
    "연령(10점)",
    "연령점수",
  ],

  scoreDisability: [
    "장애유무",
    "장애유무(15점)",
    "장애유무(10점)",
    "장애점수",
  ],

  scoreResidencePeriod: [
    "거주기간",
    "거주기간(10점)",
    "거주기간점수",
  ],

  scoreBenefitType: [
    "수급형태(20점)",
    "수급형태(10점)",
    "수급형태점수",
    "수급점수",
  ],

  scoreOther: [
    "기타(장애아동가정,한부모가정등)(10점)",
    "기타",
    "기타(30점)",
    "기타점수",
  ],

  otherReason: [
    "",
    "__empty",
    "__empty_0",
  ],

  remark: [
    "비고",
    "메모",
    "특이사항",
    "__empty_1",
  ],

  airconType: [
    "에어컨종류",
    "에어컨 종류",
  ],
};

/**
 * 시트 읽기
 */
function parseWorkbook(buffer: Buffer): JsonRow[] {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("엑셀 시트를 찾을 수 없습니다.");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) {
    throw new Error("첫 번째 시트를 읽을 수 없습니다.");
  }

  const rows = XLSX.utils.sheet_to_json<JsonRow>(worksheet, {
    defval: "",
    raw: false,
  });

  if (!rows.length) {
    throw new Error("엑셀에 데이터가 없습니다.");
  }

  return rows;
}

/**
 * 실제 키 찾기
 */
function findHeaderKey(row: JsonRow, aliases: string[]): string | null {
  const keys = Object.keys(row);

  for (const key of keys) {
    const normalizedKey = normalizeHeader(key);

    for (const alias of aliases) {
      const normalizedAlias = normalizeHeader(alias);
      if (normalizedAlias === normalizedKey) {
        return key;
      }
    }
  }

  return null;
}

/**
 * 헤더 해석
 */
function resolveHeaders(rows: JsonRow[]) {
  const sample = rows[0] ?? {};
  const result: Record<string, string | null> = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    result[field] = findHeaderKey(sample, aliases);
  }

  const requiredFields = [
    "localNo",
    "dong",
    "benefitType",
    "name",
    "rrn",
    "roadAddress",
    "totalScore",
  ];

  const missing = requiredFields.filter((field) => !result[field]);

  if (missing.length > 0) {
    throw new Error(`필수 헤더를 찾을 수 없습니다: ${missing.join(", ")}`);
  }

  return result as Record<
    keyof Omit<ParsedRow, "programYear" | "listType">,
    string | null
  >;
}

/**
 * 순위 보정
 * - 순위 값이 비어있는 행이 실제 파일에 있으므로 localNo 또는 rowIndex로 fallback
 */
function resolveRank(rawRank: unknown, localNo: number | null, rowIndex: number): number {
  const parsedRank = toNumber(rawRank);
  if (parsedRank && parsedRank > 0) return parsedRank;
  if (localNo && localNo > 0) return localNo;
  return rowIndex - 1;
}

/**
 * row -> entity
 */
function mapRowToEntity(
  row: JsonRow,
  headers: Record<keyof Omit<ParsedRow, "programYear" | "listType">, string | null>,
  programYear: number,
  listType: ListType,
  rowIndex: number
): ParsedRow {
  const getValue = (field: keyof Omit<ParsedRow, "programYear" | "listType">) => {
    const headerKey = headers[field];
    if (!headerKey) return "";
    return row[headerKey];
  };

  const localNo = toNumber(getValue("localNo"));
  const categoryCodeRaw = toNumber(getValue("categoryCode"));

  const totalScore = toNumber(getValue("totalScore"));
  const rank = resolveRank(getValue("rank"), localNo, rowIndex);

  const entity: ParsedRow = {
    programYear,
    listType,
    localNo: localNo ?? rowIndex - 1,
    categoryCode: categoryCodeRaw ?? localNo ?? rowIndex - 1,
    dong: cleanString(getValue("dong")),
    benefitType: cleanString(getValue("benefitType")),
    name: cleanString(getValue("name")),
    rrn: toSafeText(getValue("rrn")),
    phone: nullableString(getValue("phone")),
    proxyPhone: nullableString(getValue("proxyPhone")),
    roadAddress: cleanString(getValue("roadAddress")),
    detailAddress: nullableString(getValue("detailAddress")),
    // 추가된 부분: 초기값은 null로 설정 (이후 루프에서 API 호출 후 채워짐)
    latitude: null,
    longitude: null,
    rank,
    totalScore: totalScore ?? 0,
    scoreHouseholdSize: toNumber(getValue("scoreHouseholdSize")),
    scoreAge: toNumber(getValue("scoreAge")),
    scoreDisability: toNumber(getValue("scoreDisability")),
    scoreResidencePeriod: toNumber(getValue("scoreResidencePeriod")),
    scoreBenefitType: toNumber(getValue("scoreBenefitType")),
    scoreOther: toNumber(getValue("scoreOther")),
    otherReason: nullableString(getValue("otherReason")),
    remark: nullableString(getValue("remark")),
    airconType: nullableString(getValue("airconType")),
    isArchived: false,
    isComplete: false,
    isCancel: false,
    routeOrder: 0
  };

  const missingFields: string[] = [];

  if (!entity.localNo) missingFields.push("localNo(구분)");
  if (!entity.dong) missingFields.push("dong(동명)");
  if (!entity.benefitType) missingFields.push("benefitType(자격형태)");
  if (!entity.name) missingFields.push("name(성명)");
  if (!entity.rrn) missingFields.push("rrn(주민등록번호)");
  if (!entity.roadAddress) missingFields.push("roadAddress(도로명주소)");
  if (entity.totalScore === null || entity.totalScore === undefined || entity.totalScore <= 0) {
    missingFields.push("totalScore(총점)");
  }

  if (missingFields.length > 0) {
    throw new Error(`${rowIndex}행 데이터 오류 - 필수값 누락: ${missingFields.join(", ")}`);
  }

  return entity;
}

/**
 * 비어있는 행 제거
 */
function isMeaningfulRow(row: JsonRow): boolean {
  const values = Object.values(row).map((v) => cleanString(v));
  return values.some((v) => v !== "");
}

/**
 * import/upload
 */
router.post(
  "/upload",
  upload.single("file"),
  async (req: Request<unknown, unknown, UploadBody>, res: Response) => {
    let tx: Transaction | null = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          message: "업로드할 엑셀 파일이 없습니다. field name은 file 이어야 합니다.",
        });
      }
      console.log(req.body);

      const programYear = Number(req.body.programYear ?? 2025);
      const listType = req.body.listType;


      const overwrite = String(req.body.overwrite ?? "true") === "true";

      if (!Number.isInteger(programYear) || programYear < 2000) {
        return res.status(400).json({
          ok: false,
          message: "programYear 값이 올바르지 않습니다.",
        });
      }

      if (listType !== "SELECTED" && listType !== "WAITLIST") {
        return res.status(400).json({
          ok: false,
          message: "listType 값은 SELECTED 또는 WAITLIST 이어야 합니다.",
        });
      }

      const rawRows = parseWorkbook(req.file.buffer).filter(isMeaningfulRow);
      const headers = resolveHeaders(rawRows);

      const parsedRows: ParsedRow[] = [];
      const errors: string[] = [];

      // 순차적으로 좌표를 가져오기 위해 for...of 문 사용 (API 과부하 방지)
      for (const [index, row] of rawRows.entries()) {
        const rowNumber = index + 2;
        try {
          const entity = mapRowToEntity(row, headers, programYear, listType, rowNumber);

          // 주소를 좌표로 변환 (추가된 부분)
          const coords = await getCoordsByAddress(entity.roadAddress);
          entity.latitude = coords.latitude;
          entity.longitude = coords.longitude;

          parsedRows.push(entity);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : `${rowNumber}행 처리 실패`);
        }
      }

      if (!parsedRows.length) {
        return res.status(400).json({
          ok: false,
          message: "저장 가능한 데이터가 없습니다.",
          errors,
        });
      }

      tx = await sequelize.transaction();

      if (overwrite) {
        await CleanUpHousehold.destroy({
          where: {
            programYear,
            listType,
          },
          transaction: tx,
        });

        await CleanUpHousehold.bulkCreate(
          parsedRows.map((row) => ({
            programYear: row.programYear,
            listType: row.listType,
            localNo: row.localNo,
            categoryCode: row.categoryCode,
            dong: row.dong,
            benefitType: row.benefitType,
            name: row.name,
            rrn: row.rrn,
            phone: row.phone,
            proxyPhone: row.proxyPhone,
            roadAddress: row.roadAddress,
            detailAddress: row.detailAddress,
            rank: row.rank,
            totalScore: row.totalScore,
            scoreHouseholdSize: row.scoreHouseholdSize,
            scoreAge: row.scoreAge,
            scoreDisability: row.scoreDisability,
            scoreResidencePeriod: row.scoreResidencePeriod,
            scoreBenefitType: row.scoreBenefitType,
            scoreOther: row.scoreOther,
            otherReason: row.otherReason,
            remark: row.remark,
            latitude: row.latitude,
            longitude: row.longitude,
            isArchived: row.isArchived,
            routeOrder: row.routeOrder,
            isComplete: row.isComplete,
            isCancel: row.isCancel
            // airconType: row.airconType, // 모델 추가 후 활성화
          })),
          {
            transaction: tx,
            validate: true,
          }
        );
      } else {
        await CleanUpHousehold.bulkCreate(
          parsedRows.map((row) => ({
            programYear: row.programYear,
            listType: row.listType,
            localNo: row.localNo,
            categoryCode: row.categoryCode,
            dong: row.dong,
            benefitType: row.benefitType,
            name: row.name,
            rrn: row.rrn,
            phone: row.phone,
            proxyPhone: row.proxyPhone,
            roadAddress: row.roadAddress,
            detailAddress: row.detailAddress,
            rank: row.rank,
            totalScore: row.totalScore,
            scoreHouseholdSize: row.scoreHouseholdSize,
            scoreAge: row.scoreAge,
            scoreDisability: row.scoreDisability,
            scoreResidencePeriod: row.scoreResidencePeriod,
            scoreBenefitType: row.scoreBenefitType,
            scoreOther: row.scoreOther,
            otherReason: row.otherReason,
            remark: row.remark,
            isArchived: row.isArchived,
            routeOrder: row.routeOrder,
            isComplete: row.isComplete,
            isCancel: row.isCancel
            // airconType: row.airconType, // 모델 추가 후 활성화
          })),
          {
            transaction: tx,
            validate: true,
            updateOnDuplicate: [
              "listType",
              "localNo",
              "categoryCode",
              "dong",
              "benefitType",
              "name",
              "rrn",
              "phone",
              "proxyPhone",
              "roadAddress",
              "detailAddress",
              "rank",
              "totalScore",
              "scoreHouseholdSize",
              "scoreAge",
              "scoreDisability",
              "scoreResidencePeriod",
              "scoreBenefitType",
              "scoreOther",
              "otherReason",
              "remark",
            ],
          }
        );
      }

      await tx.commit();

      return res.status(200).json({
        ok: true,
        message: "엑셀 업로드 및 DB 저장이 완료되었습니다.",
        fileName: req.file.originalname,
        programYear,
        listType,
        totalRows: rawRows.length,
        savedRows: parsedRows.length,
        errorCount: errors.length,
        errors,
      });
    } catch (error) {
      if (tx) {
        await tx.rollback();
      }

      console.error(error);

      return res.status(500).json({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "업로드 처리 중 오류가 발생했습니다.",
      });
    }
  }
);

export default router;