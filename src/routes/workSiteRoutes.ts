import { Router, Request, Response } from "express";
import { Op, WhereOptions, Transaction } from "sequelize";
import multer from "multer";
import XLSX from "xlsx";
import { sequelize } from "../config/database";
import { WorkSite } from "../models/WorkSite";
import { WorkItem } from "../models/WorkItem";
import { getCoordsByAddress } from "../utils/geocoder";
import { checkLevel } from "../middlewares/authMiddleware";

const router = Router();

// 엑셀 업로드용 메모리 스토리지
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB 제한
});

/**
 * 1. 현장(WorkSite) 목록 조회 (💡 권한별 뷰 분기 적용)
 */
router.get("/", checkLevel, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 20;
    const keyword = (req.query.keyword as string) || "";

    const where: WhereOptions = {};
    if (keyword) {
      where.title = { [Op.like]: `%${keyword}%` };
    }

    // 💡 레벨 9 현장관리자는 본인이 등록(또는 배정받은) 현장만 조회
    if (user.level === 9) {
      where.memberId = user.id;
    }

    const offset = (page - 1) * pageSize;
    const { count, rows } = await WorkSite.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      offset,
      limit: pageSize,
    });

    return res.status(200).json({ ok: true, data: rows, total: count });
  } catch (error) {
    console.error("현장 목록 조회 에러:", error);
    return res.status(500).json({ ok: false, message: "서버 오류가 발생했습니다." });
  }
});

/**
 * 2. 현장(WorkSite) 등록 (엑셀 업로드 전, 껍데기 생성)
 */
router.post("/", checkLevel, async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const user = (req as any).user;
    const { title, description, hasSurvey, listVisibleFields, detailVisibleFields, mobileListVisibleFields } = req.body;

    if (!title) {
      await tx.rollback();
      return res.status(400).json({ ok: false, message: "현장명은 필수입니다." });
    }

    const newSite = await WorkSite.create({
      memberId: user.level === 9 ? user.id : null, // 💡 레벨 9면 자기 ID, 아니면 null
      title,
      description: description || null,
      hasSurvey: hasSurvey === true || hasSurvey === "true",
      listVisibleFields: listVisibleFields || [],     
      detailVisibleFields: detailVisibleFields || [], 
      mobileListVisibleFields: mobileListVisibleFields || []
    }, { transaction: tx });

    await tx.commit();
    return res.status(201).json({ ok: true, data: newSite, message: "현장이 등록되었습니다." });
  } catch (error) {
    if (tx) await tx.rollback();
    console.error("현장 등록 에러:", error);
    return res.status(500).json({ ok: false, message: "등록에 실패했습니다." });
  }
});

/**
 * 3. 현장(WorkSite) 정보 수정 및 💡 담당자 배정 처리
 */
router.patch("/:id", checkLevel, async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const site = await WorkSite.findByPk(Number(id));

    if (!site) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "현장을 찾을 수 없습니다." });
    }

    // 💡 [핵심 방어 로직] memberId 배정을 시도하는 경우
    if (req.body.memberId !== undefined) {
      // 1. 레벨 10 최고관리자만 배정 가능
      if (user.level !== 10) {
        await tx.rollback();
        return res.status(403).json({ ok: false, message: "담당자 배정 권한이 없습니다." });
      }
      // 2. 이미 담당자가 있는 경우(null이 아닌 경우) 배정 불가
      if (site.memberId !== null) {
        await tx.rollback();
        return res.status(400).json({ ok: false, message: "이미 담당자가 배정된 현장입니다." });
      }
    }

    // 💡 레벨 9 현장관리자는 남의 현장(본인 ID가 아닌 현장) 수정 불가
    if (user.level === 9 && site.memberId !== user.id) {
      await tx.rollback();
      return res.status(403).json({ ok: false, message: "본인의 현장만 수정할 수 있습니다." });
    }

    await site.update(req.body, { transaction: tx });
    await tx.commit();

    return res.status(200).json({ ok: true, data: site });
  } catch (error) {
    if (tx) await tx.rollback();
    return res.status(500).json({ ok: false, message: "수정 중 오류 발생" });
  }
});

/**
 * 3-1. 현장(WorkSite) 정보 수정 (PUT 요청 대응 추가)
 */
router.put("/:id", checkLevel, async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const user = (req as any).user;
    const { id } = req.params;
    const site = await WorkSite.findByPk(Number(id));

    if (!site) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "현장을 찾을 수 없습니다." });
    }

    if (user.level === 9 && site.memberId !== user.id) {
      await tx.rollback();
      return res.status(403).json({ ok: false, message: "권한이 없습니다." });
    }

    await site.update(req.body, { transaction: tx });
    await tx.commit();

    return res.status(200).json({ ok: true, data: site, message: "수정되었습니다." });
  } catch (error) {
    if (tx) await tx.rollback();
    console.error("현장 수정 에러:", error);
    return res.status(500).json({ ok: false, message: "수정 중 오류 발생" });
  }
});

/**
 * 4. 현장(WorkSite) 삭제 (연결된 WorkItem, Report 등 Cascade 삭제됨)
 */
router.delete("/:id", checkLevel, async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const user = (req as any).user;
    const site = await WorkSite.findByPk(Number(req.params.id));
    
    if (!site) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "현장을 찾을 수 없습니다." });
    }

    if (user.level === 9 && site.memberId !== user.id) {
      await tx.rollback();
      return res.status(403).json({ ok: false, message: "본인의 현장만 삭제할 수 있습니다." });
    }

    await site.destroy({ transaction: tx });
    await tx.commit();
    return res.status(200).json({ ok: true, message: "삭제되었습니다." });
  } catch (error) {
    if (tx) await tx.rollback();
    return res.status(500).json({ ok: false, message: "삭제 중 오류 발생" });
  }
});

/**
 * 5. 🔥 특정 현장에 엑셀 데이터 업로드 (동적 파싱 & 위치 변환)
 */
router.post("/:id/upload", checkLevel, upload.single("file"), async (req: Request, res: Response) => {
  let tx: Transaction | null = null;
  try {
    const user = (req as any).user;
    const siteId = Number(req.params.id);
    const site = await WorkSite.findByPk(siteId);

    if (!site) return res.status(404).json({ ok: false, message: "현장을 찾을 수 없습니다." });
    if (!req.file) return res.status(400).json({ ok: false, message: "엑셀 파일이 없습니다." });

    if (user.level === 9 && site.memberId !== user.id) {
      return res.status(403).json({ ok: false, message: "업로드 권한이 없습니다." });
    }

    // 1. 엑셀 읽기
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (rawRows.length === 0) {
      return res.status(400).json({ ok: false, message: "데이터가 비어있습니다." });
    }

    tx = await sequelize.transaction();

    // 2. 엑셀 헤더(컬럼명) 추출 후 WorkSite에 저장
    const headers = Object.keys(rawRows[0]);
    await site.update({ excelHeaders: headers }, { transaction: tx });

    // 3. 기존 데이터 덮어쓰기 옵션 처리 (필요시)
    if (req.body.overwrite === "true") {
      await WorkItem.destroy({ where: { workSiteId: siteId }, transaction: tx });
    }

    const parsedItems = [];
    const errors: string[] = [];

    // 4. 로우 데이터 파싱 (고객명, 주소 유추 로직 포함)
    for (const [index, row] of rawRows.entries()) {
      try {
        let extractedCustomerName = "미지정 고객";
        let extractedAddress = "";

        // 동적으로 엑셀 컬럼을 순회하며 '이름', '주소' 관련 항목을 휴리스틱으로 찾아냄
        for (const key of Object.keys(row)) {
          const val = String(row[key] || "").trim();
          
          if (key.includes("고객명") || key.includes("이름") || key.includes("성명") || key.includes("경로당")) {
            if (val) extractedCustomerName = val;
          }
          if (key.includes("주소") || key.includes("도로명") || key.includes("소재지")) {
            if (val) extractedAddress = val;
          }
        }

        // 주소가 발견되면 카카오 내비 연동을 위한 위/경도 변환
        let lat = null, lng = null;
        if (extractedAddress) {
          try {
            const coords = await getCoordsByAddress(extractedAddress);
            lat = coords.latitude;
            lng = coords.longitude;
          } catch (e) {
            console.warn(`[${index + 2}행] 주소 변환 실패: ${extractedAddress}`);
          }
        }

        // WorkItem 조립
        parsedItems.push({
          workSiteId: siteId,
          customerName: extractedCustomerName,
          rowData: row, // 엑셀의 모든 데이터를 JSON으로 통째로 저장
          latitude: lat,
          longitude: lng,
          status: 'PENDING',
          routeOrder: index + 1 // 등록된 순서대로 기본 우선순위 부여
        });

      } catch (err) {
        errors.push(`${index + 2}행 파싱 오류`);
      }
    }

    // 5. Bulk Create
    await WorkItem.bulkCreate(parsedItems as any, { transaction: tx });
    await tx.commit();

    return res.status(200).json({
      ok: true,
      total: rawRows.length,
      saved: parsedItems.length,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    if (tx) await tx.rollback();
    console.error("엑셀 업로드 처리 에러:", error);
    return res.status(500).json({ ok: false, message: "엑셀 처리 중 서버 오류" });
  }
});

export default router;