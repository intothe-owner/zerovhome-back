import { Router, Request, Response } from "express";
import { Op, WhereOptions } from "sequelize";
import { SeniorCenterCleanUp } from "../models/SeniorCenterCleanUp";
import { sequelize } from "../config/database";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

const router = Router();

// S3 설정 (households.ts 참고)
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

/**
 * 1. 경로당 목록 조회 (필터 및 검색 포함)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    // 쿼리 스트링 추출 (기본값 설정)
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 20;
    const keyword = (req.query.keyword as string) || "";
    const sortField = (req.query.sortField as string) || "seq";
    const sortOrder = (req.query.sortOrder as string) || "ASC";
    
    // 필터 파라미터 추출
    const isComplete = req.query.isComplete;
    const isArchive = req.query.isArchive; // 작업동선(보관) 여부 추가
    console.log(isArchive);
    const programYear = req.query.programYear;

    const baseWhere: WhereOptions = {};
    console.log(req.query);

    // 사업 연도 필터
    if (programYear) {
      baseWhere.programYear = Number(programYear);
    }

    // ✅ [중요] 탭 구분을 위한 필터 로직
    
    // 1. 작업 완료 여부 필터 (true/false)
    if (isComplete !== undefined && isComplete !== "") {
      baseWhere.isComplete = isComplete === "true";
    }

    // 2. 작업 동선(보관) 여부 필터 (true/false)
    if (isArchive !== undefined && isArchive !== "") {
      baseWhere.isArchive = isArchive === "true";
    }

    // ✅ 통합 키워드 검색 (이름, 담당자, 주소, 연락처 등)
    const where: WhereOptions = keyword
      ? {
          ...baseWhere,
          [Op.or]: [
            { name: { [Op.like]: `%${keyword}%` } },
            { managerName: { [Op.like]: `%${keyword}%` } },
            { roadAddress: { [Op.like]: `%${keyword}%` } },
            { managerPhone: { [Op.like]: `%${keyword}%` } },
            { centerPhone: { [Op.like]: `%${keyword}%` } },
            { dong: { [Op.like]: `%${keyword}%` } },
          ],
        }
      : baseWhere;

    // ✅ 페이징 계산
    const offset = (page - 1) * pageSize;
    const limit = pageSize;

    // ✅ 데이터 조회 및 전체 건수 확인
    const { count, rows } = await SeniorCenterCleanUp.findAndCountAll({
      where,
      order: [[sortField, sortOrder]],
      offset,
      limit,
    });

    return res.status(200).json({
      ok: true,
      data: rows,
      total: count,
    });
  } catch (error) {
    console.error("목록 조회 에러:", error);
    return res.status(500).json({ ok: false, message: "서버 오류가 발생했습니다." });
  }
});

/**
 * 2. 경로당 상세 조회
 */
/**
 * 2. 경로당 상세 조회 (관련 보고서 사진 포함)
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idNum = Number(id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      return res.status(400).json({ ok: false, message: "유효하지 않은 경로당 ID입니다." });
    }
    // Report 조인을 제거하고 단일 테이블만 조회합니다. (JSON 컬럼으로 사진 데이터가 이미 포함되어 있음)
    const center = await SeniorCenterCleanUp.findByPk(idNum);

    if (!center) {
      return res.status(404).json({ ok: false, message: "데이터를 찾을 수 없습니다." });
    }

    return res.status(200).json({ ok: true, data: center });
  } catch (error) {
    console.error("상세 조회 에러:", error);
    return res.status(500).json({ ok: false, message: "서버 오류" });
  }
});

/**
 * 3. 경로당 정보 수정 (상태 업데이트 등)
 */
router.patch("/:id", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const { id } = req.params;
    const idNum = Number(id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      return res.status(400).json({ ok: false, message: "유효하지 않은 경로당 ID입니다." });
    }
    const center = await SeniorCenterCleanUp.findByPk(idNum);
    

    if (!center) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "대상을 찾을 수 없습니다." });
    }
    console.log(req.body);
    // 요청 본문의 데이터로 업데이트
    await center.update(req.body, { transaction: tx });
    await tx.commit();

    return res.status(200).json({ ok: true, data: center });
  } catch (error) {
    if (tx) await tx.rollback();
    return res.status(500).json({ ok: false, message: "수정 중 오류 발생" });
  }
});

/**
 * 4. 경로당 데이터 삭제 (S3 이미지 삭제 포함)
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const { id } = req.params;
    const idNum = Number(id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      return res.status(400).json({ ok: false, message: "유효하지 않은 경로당 ID입니다." });
    }
    const center = await SeniorCenterCleanUp.findByPk(idNum);

    if (!center) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "대상을 찾을 수 없습니다." });
    }

    // S3에 저장된 사진들이 있다면 삭제 처리 (households.ts 패턴)
    const imageFields = ["beforeImage", "afterImage"]; // 예시 필드
    for (const field of imageFields) {
      const imageUrl = (center as any)[field];
      if (imageUrl && imageUrl.includes("amazonaws.com")) {
        const key = imageUrl.split(".com/")[1];
        await s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME!,
          Key: key,
        }));
      }
    }

    await center.destroy({ transaction: tx });
    await tx.commit();

    return res.status(200).json({ ok: true, message: "삭제되었습니다." });
  } catch (error) {
    if (tx) await tx.rollback();
    return res.status(500).json({ ok: false, message: "삭제 중 오류 발생" });
  }
});

/**
 * 5. 경로당 정보 등록 (신규 생성)
 */
router.post("/", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const {
      name,
      dong,
      roadAddress,
      detailAddress,
      lat,
      lng,
      area,
      acCeiling,
      acStand,
      acWall,
      airPurifier,
      managerName,
      managerPhone,
      remark,
    } = req.body;

    // 1. 필수 값 검증
    if (!name || !roadAddress) {
      await tx.rollback();
      return res.status(400).json({ ok: false, message: "경로당명과 주소는 필수 입력 항목입니다." });
    }

    // 2. 주소 병합 (도로명 주소 + 상세 주소)
    const fullAddress = detailAddress ? `${roadAddress} ${detailAddress}` : roadAddress;

    // 3. seq (연번) 자동 채번 로직 (가장 큰 seq 값을 찾아 +1 적용)
    // DB에서 auto_increment를 사용 중이라면 이 부분은 생략하고 새 객체에서 seq 속성을 지워도 무방합니다.
    const maxSeqCenter = await SeniorCenterCleanUp.findOne({
      order: [['seq', 'DESC']],
      attributes: ['seq'],
      transaction: tx,
    });
    const nextSeq = maxSeqCenter?.seq ? maxSeqCenter.seq + 1 : 1;

    // 4. DB에 저장할 데이터 객체 구성 (프론트 필드 -> DB 컬럼 매핑)
    const newCenterData = {
      programYear: new Date().getFullYear(), // 현재 연도로 기본 세팅
      seq: nextSeq,
      name,
      dong: dong || null,
      roadAddress: fullAddress,
      // lat: lat ? String(lat) : null,  // DB에 lat, lng 컬럼이 있다면 주석 해제
      // lng: lng ? String(lng) : null,
      area: area ? Number(area) : null,
      acCeilingCount: Number(acCeiling) || 0,
      acStandCount: Number(acStand) || 0,
      acWallCount: Number(acWall) || 0,
      airPurifierCount: Number(airPurifier) || 0,
      managerName: managerName || null,
      managerPhone: managerPhone || null,
      remark: remark || null,
      isComplete: false, // 신규 등록 시 기본값
      isArchive: false,  // 신규 등록 시 기본값
      isCancel:false
    };

    // 5. DB 생성 및 트랜잭션 커밋
    const newCenter = await SeniorCenterCleanUp.create(newCenterData, { transaction: tx });
    
    await tx.commit();

    return res.status(201).json({ 
      ok: true, 
      data: newCenter, 
      message: "성공적으로 등록되었습니다." 
    });

  } catch (error) {
    if (tx) await tx.rollback();
    console.error("경로당 등록 에러:", error);
    return res.status(500).json({ ok: false, message: "서버 오류로 인해 등록에 실패했습니다." });
  }
});
export default router;