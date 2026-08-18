import { Router, Request, Response } from "express";
import multer from "multer";
import XLSX from "xlsx";
import { Transaction } from "sequelize";
import { sequelize } from "../db/sequelize";
import { SeniorCenterCleanUp } from "../models/SeniorCenterCleanUp"; // 새로 만드실 모델
import { getCoordsByAddress } from "../utils/geocoder";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/**
 * 엑셀 데이터 파싱을 위한 타입 정의
 */
type SeniorCenterParsedRow = {
  programYear: number;
  seq: number;
  name: string;
  dong: string;
  roadAddress: string;
  managerName: string | null;
  managerPhone: string | null;
  centerPhone: string | null;
  facilityType: string | null;
  area: number | null;
  acCeilingCount: number;
  acStandCount: number;
  acWallCount: number;
  airPurifierCount: number;
  remark: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * 헤더 정규화 및 문자열 정리 유틸리티
 */
function cleanValue(v: any): string {
  return String(v || "").trim().replace(/\n/g, " ");
}

function parseNum(v: any): number {
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

/**
 * 경로당 엑셀 업로드 API
 */
router.post(
  "/",
  upload.single("file"),
  async (req: Request, res: Response) => {
    let tx: Transaction | null = null;

    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, message: "파일이 없습니다." });
      }

      const programYear = Number(req.body.programYear || 2026);
      
      // 엑셀 읽기
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      // 헤더가 여러 줄이거나 병합된 경우를 대비해 2번째 줄부터 데이터를 읽도록 설정 (range: 1 또는 2)
      const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      const parsedRows: SeniorCenterParsedRow[] = [];
      const errors: string[] = [];

      for (const [index, row] of rawRows.entries()) {
        try {
          // 엑셀 컬럼명 매핑 (업로드하신 엑셀 스니펫 기준)
          const entity: SeniorCenterParsedRow = {
            programYear,
            seq: parseNum(row["연번"]),
            name: cleanValue(row["경로당 명"]),
            dong: cleanValue(row["동명"]),
            roadAddress: cleanValue(row["소재지 도로명주소"]),
            managerName: cleanValue(row["담당자"]) || null,
            managerPhone: cleanValue(row["연락처"]) || null,
            centerPhone: cleanValue(row["경로당\n연락처"]) || null,
            facilityType: cleanValue(row["시설\n유형"]) || null,
            area: parseNum(row["면적(㎡)"]),
            // 에어컨 설치현황 (엑셀의 중복 헤더 대응 필요 시 인덱스나 정확한 키값 확인)
            acCeilingCount: parseNum(row["천장형"]),
            acStandCount: parseNum(row["스탠드"]),
            acWallCount: parseNum(row["벽걸이"]),
            airPurifierCount: parseNum(row["공기청정기"]),
            remark: cleanValue(row["비고\n계약 대수\n천:93,스:156,벽:148,공청:349 "]) || null,
            latitude: null,
            longitude: null,
          };

          if (!entity.name || !entity.roadAddress) continue; // 필수값 없으면 스킵

          // 주소 기반 좌표 추출
          const coords = await getCoordsByAddress(entity.roadAddress);
          entity.latitude = coords.latitude;
          entity.longitude = coords.longitude;

          parsedRows.push(entity);
        } catch (err) {
          errors.push(`${index + 2}행 처리 중 오류: ${err}`);
        }
      }

      tx = await sequelize.transaction();

      // 기존 데이터 덮어쓰기 (선택 사항)
      if (req.body.overwrite === "true") {
        await SeniorCenterCleanUp.destroy({
          where: { programYear },
          transaction: tx,
        });
      }

      // 대량 저장
      await SeniorCenterCleanUp.bulkCreate(parsedRows as any, {
        transaction: tx,
        validate: true,
      });

      await tx.commit();

      return res.status(200).json({
        ok: true,
        total: rawRows.length,
        saved: parsedRows.length,
        errors,
      });
    } catch (error) {
      if (tx) await tx.rollback();
      console.error(error);
      return res.status(500).json({ ok: false, message: "서버 오류" });
    }
  }
);

export default router;