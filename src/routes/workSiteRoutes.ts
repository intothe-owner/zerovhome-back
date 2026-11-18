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
 * 💡 [신규 추가] 내 현장 목록 조회 (기업회원 대시보드 전용)
 * GET /api/work-sites/my-sites
 */
router.get("/my-sites", checkLevel, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    
    // 토큰 페이로드 구조에 따라 범용적으로 식별자 추출
    const userId = user.id || user.userId || user.memberId || user.no;

    if (!userId) {
      console.error("[인증 에러] 토큰에서 유저 식별자를 찾을 수 없습니다. 페이로드:", user);
      return res.status(401).json({ ok: false, message: "유저 식별자를 찾을 수 없습니다." });
    }

    // 본인(기업회원) 계정으로 등록했거나 배정된 현장만 조건 검색
    const sites = await WorkSite.findAll({
      where: { memberId: userId },
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({ ok: true, data: sites });
  } catch (error) {
    console.error("내 현장 목록 조회 에러:", error);
    return res.status(500).json({ ok: false, message: "서버 오류가 발생했습니다." });
  }
});

/**
 * 1. 현장(WorkSite) 전체/권한별 목록 조회 (어드민 또는 통합 뷰 용도)
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

    const userId = user.id || user.userId || user.memberId || user.no;

    if (!userId) {
      return res.status(401).json({ ok: false, message: "유저 식별자를 찾을 수 없습니다." });
    }

    // 관리자(레벨 10)가 아닌 레벨 9(현장관리자/기업회원)일 경우의 기본 방어선 유지
    if (user.level === 9) {
      where.memberId = userId;
    } else if (user.level === 1) {
      const assignedItems = await WorkItem.findAll({
        where: { assignedMemberId: userId },
        attributes: ['workSiteId'],
        raw: true
      });
      const siteIds = assignedItems.map(item => item.workSiteId);
      where.id = { [Op.in]: siteIds.length > 0 ? siteIds : [0] }; 
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
 * 2. 현장(WorkSite) 등록 (💡 프론트엔드 연동: address 파라미터 추가 & 자동 memberId 맵핑)
 */
router.post("/", checkLevel, async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const user = (req as any).user;
    // 💡 프론트엔드에서 보낸 address 포함
    const { title, address, description, hasSurvey, listVisibleFields, detailVisibleFields, mobileListVisibleFields } = req.body;
    
    const userId = user.id || user.userId || user.memberId || user.no;

    if (!title) {
      await tx.rollback();
      return res.status(400).json({ ok: false, message: "현장명은 필수입니다." });
    }
    if (!userId) {
      await tx.rollback();
      return res.status(401).json({ ok: false, message: "인증 정보가 올바르지 않습니다." });
    }

    const newSite = await WorkSite.create({
      // 💡 최고관리자가 아닌 일반 등록이면 무조건 등록하는 토큰의 주인을 담당자로 맵핑
      memberId: user.level !== 10 ? userId : null,
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
 * 3. 현장(WorkSite) 정보 수정 및 담당자 배정 처리
 */
router.patch("/:id", checkLevel, async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const user = (req as any).user;
    const userId = user.id || user.userId || user.memberId || user.no;
    const { id } = req.params;
    const site = await WorkSite.findByPk(Number(id));

    if (!site) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "현장을 찾을 수 없습니다." });
    }

    if (req.body.memberId !== undefined) {
      if (user.level !== 10) {
        await tx.rollback();
        return res.status(403).json({ ok: false, message: "담당자 배정 권한이 없습니다." });
      }
      if (site.memberId !== null && site.memberId !== req.body.memberId) {
        await tx.rollback();
        return res.status(400).json({ ok: false, message: "이미 담당자가 배정된 현장입니다." });
      }
    }

    // 💡 본인의 현장인지 체크 로직 강화
    if (user.level === 9 && site.memberId !== userId) {
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
    const userId = user.id || user.userId || user.memberId || user.no;
    const { id } = req.params;
    const site = await WorkSite.findByPk(Number(id));

    if (!site) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "현장을 찾을 수 없습니다." });
    }

    if (user.level === 9 && site.memberId !== userId) {
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
 * 4. 현장(WorkSite) 삭제
 */
router.delete("/:id", checkLevel, async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const user = (req as any).user;
    const userId = user.id || user.userId || user.memberId || user.no;
    const site = await WorkSite.findByPk(Number(req.params.id));
    
    if (!site) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "현장을 찾을 수 없습니다." });
    }

    if (user.level === 9 && site.memberId !== userId) {
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
 * 5. 🔥 특정 현장에 엑셀 데이터 업로드
 */
router.post("/:id/upload", checkLevel, upload.single("file"), async (req: Request, res: Response) => {
  let tx: Transaction | null = null;
  try {
    const user = (req as any).user;
    const userId = user.id || user.userId || user.memberId || user.no;
    const siteId = Number(req.params.id);
    const site = await WorkSite.findByPk(siteId);

    if (!site) return res.status(404).json({ ok: false, message: "현장을 찾을 수 없습니다." });
    if (!req.file) return res.status(400).json({ ok: false, message: "엑셀 파일이 없습니다." });

    if (user.level === 9 && site.memberId !== userId) {
      return res.status(403).json({ ok: false, message: "업로드 권한이 없습니다." });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (rawRows.length === 0) {
      return res.status(400).json({ ok: false, message: "데이터가 비어있습니다." });
    }

    tx = await sequelize.transaction();

    const headers = Object.keys(rawRows[0]);
    await site.update({ excelHeaders: headers }, { transaction: tx });

    if (req.body.overwrite === "true") {
      await WorkItem.destroy({ where: { workSiteId: siteId }, transaction: tx });
    }

    const parsedItems = [];
    const errors: string[] = [];

    for (const [index, row] of rawRows.entries()) {
      try {
        let extractedCustomerName = "미지정 고객";
        let extractedAddress = "";

        for (const key of Object.keys(row)) {
          const val = String(row[key] || "").trim();
          if (key.includes("고객명") || key.includes("이름") || key.includes("성명") || key.includes("경로당")) {
            if (val) extractedCustomerName = val;
          }
          if (key.includes("주소") || key.includes("도로명") || key.includes("소재지")) {
            if (val) extractedAddress = val;
          }
        }

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

        parsedItems.push({
          workSiteId: siteId,
          customerName: extractedCustomerName,
          rowData: row,
          latitude: lat,
          longitude: lng,
          status: 'PENDING',
          routeOrder: index + 1
        });

      } catch (err) {
        errors.push(`${index + 2}행 파싱 오류`);
      }
    }

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