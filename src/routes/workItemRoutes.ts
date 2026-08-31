import fs from "fs";
import path from "path";
import { Router, Request, Response } from "express";
import { Op, WhereOptions } from "sequelize";
import { sequelize } from "../config/database";
import { WorkItem } from "../models/WorkItem";
import { WorkSite } from "../models/WorkSite";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import puppeteer from "puppeteer";

import { SiteReportResult } from "../models/SiteReportResult";
import { SiteSurveyResponse } from "../models/SiteSurveyResponse";
import { checkLevel } from "../middlewares/authMiddleware";
const router = Router();

// S3 설정
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
 
// Base64 서명 검증 유틸리티
function isBase64SignatureDataUrl(data: string): boolean {
  return data.startsWith("data:image/");
}

/**
 * 1. 작업 목록 조회 (통합 키워드 검색 및 페이징 적용)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 20; // Pagination 적용
    const { workSiteId, status, keyword, workerName, assignedMemberId } = req.query;

    const where: WhereOptions = {};

    if (workSiteId) {
      where.workSiteId = Number(workSiteId);
    }

    if (status) {
      if (typeof status === 'string' && status.includes(',')) {
        where.status = { [Op.in]: status.split(',') }; 
      } else {
        where.status = status;
      }
    }

    // 💡 작업자 아이디 기반 검색
    if (assignedMemberId) {
      where.assignedMemberId = Number(assignedMemberId);
    }

    // 💡 미배정 검색 ('workerName=미배정' 으로 요청이 들어왔을 때)
    if (workerName === '미배정') {
      where.assignedMemberId = null; // null이거나 빈 값인 항목 조회
    }

    if (keyword) {
      where.customerName = { [Op.like]: `%${keyword}%` };
    }

    const offset = (page - 1) * pageSize;
    const { count, rows } = await WorkItem.findAndCountAll({
      where,
      order: [
        ["routeOrder", "ASC"], 
        ["createdAt", "DESC"]
      ],
      offset,
      limit: pageSize,
    });

    return res.status(200).json({ 
      ok: true, 
      data: rows, 
      total: count, 
      page, 
      totalPages: Math.ceil(count / pageSize) 
    });
  } catch (error) {
    console.error("작업 목록 조회 에러:", error);
    return res.status(500).json({ ok: false, message: "서버 오류가 발생했습니다." });
  }
});

/**
 * 2. 작업 상세 조회
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const workItemId = Number(req.params.id);
    
    const item = await WorkItem.findByPk(workItemId, {
      include: [{ model: WorkSite, as: "site" }]
    });

    if (!item) {
      return res.status(404).json({ ok: false, message: "작업을 찾을 수 없습니다." });
    }

    const reportResult = await SiteReportResult.findOne({ where: { workItemId } });

    // 💡 2. 엉뚱한 테이블을 찾던 코드를 지우고, 정확한 모델로 쿼리하도록 수정
    const surveyResponse = await SiteSurveyResponse.findOne({ where: { workItemId } });

    return res.status(200).json({
      ok: true,
      data: {
        ...item.toJSON(),
        reportResult: reportResult ? reportResult.toJSON() : null,
        surveyResponse: surveyResponse ? surveyResponse.toJSON() : null
      }
    });

  } catch (error) {
    console.error("작업 상세 조회 에러:", error);
    return res.status(500).json({ ok: false, message: "서버 오류" });
  }
});

/**
 * 3. 작업 상태 변경 및 작업 완료 처리 (고객 서명 S3 이미지 업로드 포함)
 */
router.patch("/:id/status", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { status, workDate, workerName, customerSignature } = req.body;

    const item = await WorkItem.findByPk(Number(id), { transaction: tx });
    if (!item) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "작업을 찾을 수 없습니다." });
    }

    const updateData: any = { status };

    // 완료(COMPLETED) 처리일 경우
    if (status === "COMPLETED") {
      if (workDate) updateData.workDate = workDate;
      if (workerName) updateData.workerName = workerName;

      // 💡 [핵심] 고객 서명 데이터가 Base64 형식인 경우 S3에 이미지로 업로드
      if (customerSignature && isBase64SignatureDataUrl(customerSignature)) {
        const base64Data = customerSignature.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        const contentType = customerSignature.split(";")[0].split(":")[1] || "image/png";
        
        const fileName = `signature_work_${item.id}_${Date.now()}.png`;
        const s3Key = `uploads/signatures/${fileName}`;

        const uploadCommand = new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME!,
          Key: s3Key,
          Body: buffer,
          ContentType: contentType,
        });

        await s3.send(uploadCommand);

        // 생성된 S3 퍼블릭 URL을 DB에 저장
        updateData.customerSignature = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
      } else if (customerSignature) {
        // 이미 URL 형태로 들어온 경우 그대로 반영
        updateData.customerSignature = customerSignature;
      }
    }

    await item.update(updateData, { transaction: tx });
    await tx.commit();

    return res.status(200).json({ ok: true, data: item, message: "상태가 변경되었습니다." });
  } catch (error) {
    if (tx) await tx.rollback();
    console.error("상태 변경 에러:", error);
    return res.status(500).json({ ok: false, message: "상태 변경 중 오류 발생" });
  }
});

/**
 * 4. 위도/경도(위치) 수동 업데이트 (카카오내비 오류 시)
 */
router.patch("/:id/location", async (req: Request, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    const item = await WorkItem.findByPk(Number(req.params.id));
    
    if (!item) return res.status(404).json({ ok: false, message: "작업을 찾을 수 없습니다." });

    await item.update({ latitude, longitude });
    return res.status(200).json({ ok: true, data: item, message: "위치가 업데이트되었습니다." });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "위치 수정 오류" });
  }
});

/**
 * 5. 작업 방문 순서(routeOrder) 변경
 */
router.patch("/:id/order", async (req: Request, res: Response) => {
  try {
    const { routeOrder } = req.body;
    const item = await WorkItem.findByPk(Number(req.params.id));
    
    if (!item) return res.status(404).json({ ok: false, message: "작업을 찾을 수 없습니다." });

    await item.update({ routeOrder });
    return res.status(200).json({ ok: true, data: item, message: "순서가 변경되었습니다." });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "순서 변경 오류" });
  }
});

/**
 * 6. 작업자 배정 API
 */
router.patch("/:id/assign", async (req: Request, res: Response) => {
  try {
    const { assignedMemberId } = req.body;
    const item = await WorkItem.findByPk(Number(req.params.id));
    
    if (!item) return res.status(404).json({ ok: false, message: "작업을 찾을 수 없습니다." });

    await item.update({ assignedMemberId });
    return res.status(200).json({ ok: true, data: item, message: "작업자가 배정되었습니다." });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "배정 중 오류 발생" });
  }
});


/**
 * 7. 작업 보고서 A4 PDF 다운로드 API
 * GET /work-items/:id/pdf (라우터 프리픽스가 /api/work-items 이므로 실제 호출은 /api/work-items/:id/pdf 가 됨)
 */
router.get("/:id/pdf", async (req: Request, res: Response) => {
  try {
    const workItemId = Number(req.params.id);
    
    if (!Number.isInteger(workItemId) || workItemId <= 0) {
      return res.status(400).json({ ok: false, message: "유효하지 않은 작업 ID입니다." });
    }

    // 1. 보고서 결과 및 연결된 작업(WorkItem), 현장(WorkSite) 정보 조회
    const reportResult = await SiteReportResult.findOne({
      where: { workItemId },
      include: [
        {
          model: WorkItem,
          as: "workItem",
          include: [{ model: WorkSite, as: "site" }]
        }
      ]
    });

    if (!reportResult) {
      return res.status(404).json({ ok: false, message: "작성된 보고서가 없습니다." });
    }

    // 타입 단언을 통해 안전하게 데이터 추출
    const report = reportResult as any;
    const workItem = report.workItem;
    const site = workItem?.site;
    const { textAnswers, imageAnswers } = report;

    // 2. A4 규격에 맞춘 HTML 템플릿 작성
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="ko">
      <head>
        <meta charset="UTF-8">
        <style>
          @page { size: A4; margin: 15mm; }
          body { font-family: 'Malgun Gothic', sans-serif; margin: 0; padding: 0; color: #333; }
          h2 { text-align: center; margin-bottom: 20px; font-size: 22px; }
          .info-box { margin-bottom: 20px; font-size: 14px; background: #f9f9f9; padding: 10px; border: 1px solid #ddd; }
          .info-box p { margin: 5px 0; }
          .table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          .table th, .table td { border: 1px solid #ddd; padding: 10px; font-size: 14px; }
          .table th { background-color: #f4f4f4; width: 35%; text-align: left; }
          .section-title { font-size: 16px; font-weight: bold; margin: 20px 0 10px 0; border-left: 4px solid #007bff; padding-left: 8px; }
          .photos { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; }
          .photo-box { width: 48%; border: 1px solid #ddd; padding: 5px; text-align: center; margin-bottom: 10px; box-sizing: border-box; page-break-inside: avoid; }
          .photo-box p { font-size: 13px; font-weight: bold; margin: 5px 0; background: #eee; padding: 4px; }
          .photo-box img { width: 100%; height: 160px; object-fit: contain; }
          .signature-area { margin-top: 30px; text-align: right; font-size: 14px; page-break-inside: avoid; }
          .signature-area img { height: 50px; vertical-align: middle; margin-left: 10px; border-bottom: 1px solid #333; }
        </style>
      </head>
      <body>
        <h2>${site?.title || "현장"} 작업 완료 보고서</h2>
        
        <div class="info-box">
          <p><b>고객명:</b> ${workItem?.customerName || "-"}</p>
          <p><b>작업일자:</b> ${workItem?.workDate || "-"}</p>
          <p><b>작업담당자:</b> ${workItem?.workerName || "-"}</p>
        </div>

        <div class="section-title">상세 입력 항목</div>
        <table class="table">
          ${Object.entries(textAnswers || {}).map(([key, val]) => `
            <tr>
              <th>${key}</th>
              <td>${val}</td>
            </tr>
          `).join('')}
        </table>

        <div class="section-title">현장 사진 증빙</div>
        <div class="photos">
          ${Object.entries(imageAnswers || {}).map(([key, url]) => `
            <div class="photo-box">
              <p>${key}</p>
              <img src="${url}" alt="${key}" />
            </div>
          `).join('')}
        </div>

        <div class="signature-area">
          <span><b>고객 서명:</b></span>
          ${workItem?.customerSignature ? `<img src="${workItem.customerSignature}" alt="서명" />` : '<span>(서명 없음)</span>'}
        </div>
      </body>
      </html>
    `;

    // 3. Puppeteer로 크롬 브라우저 실행
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();

    await page.setContent(htmlContent, { waitUntil: 'networkidle0' as any } as any);

    // 4. A4 규격 PDF 버퍼로 변환
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
    });

    await browser.close();

    // 5. 클라이언트에게 PDF 파일 전송 (다운로드 처리)
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=work_report_${workItemId}.pdf`);
    return res.send(pdfBuffer);

  } catch (error) {
    console.error("PDF 생성 에러:", error);
    return res.status(500).json({ ok: false, message: "PDF 생성 중 서버 오류가 발생했습니다." });
  }
});
//배정업데이트
router.post("/assign", async (req: Request, res: Response) => {
  try {
    const { itemIds, memberId } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ ok: false, message: "배정할 작업이 선택되지 않았습니다." });
    }
    if (!memberId) {
      return res.status(400).json({ ok: false, message: "배정할 작업자가 선택되지 않았습니다." });
    }

    // 1. 배정할 회원(작업자)의 정보(이름) 조회
    // Member 모델이나 현재 사용 중인 회원 모델명에 맞게 조정하세요.
    const member = await sequelize.models.Member.findByPk(memberId);
    if (!member) {
      return res.status(404).json({ ok: false, message: "해당 작업자를 찾을 수 없습니다." });
    }
    
    // 기업명이 있으면 기업명을, 없으면 이름을 사용
    const workerName = (member as any).companyName 
      ? `${(member as any).name} (${(member as any).companyName})` 
      : (member as any).name || (member as any).loginId;

    // 2. 전달받은 작업 ID(itemIds)들에 해당하는 WorkItem 들을 일괄 업데이트
    await WorkItem.update(
      { 
        assignedMemberId: memberId,
        workerName: workerName 
      },
      { 
        where: { id: itemIds } 
      }
    );

    return res.status(200).json({ 
      ok: true, 
      message: `${itemIds.length}건의 작업 배정이 완료되었습니다.` 
    });

  } catch (error) {
    console.error("작업자 일괄 배정 에러:", error);
    return res.status(500).json({ ok: false, message: "작업자 배정 중 서버 오류가 발생했습니다." });
  }
});

export default router;