import { Router, Request, Response } from "express";
import { sequelize } from "../config/database";
import { WorkSite } from "../models/WorkSite";
import { WorkItem } from "../models/WorkItem";
import { SiteReportForm } from "../models/SiteReportForm";
import { SiteReportResult } from "../models/SiteReportResult";
// 💡 1. 반드시 설문조사 모델을 임포트 해야 합니다!
import { SiteSurveyResponse } from "../models/SiteSurveyResponse"; 
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { generateAndUploadReportPdf } from "../services/pdfService";

const router = Router();

// S3 설정
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

function isBase64DataUrl(data: string): boolean {
  return Boolean(data && data.startsWith("data:image/"));
}

async function uploadBase64ImageToS3(base64DataUrl: string, prefix: string): Promise<string> {
  const base64Data = base64DataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const contentType = base64DataUrl.split(";")[0].split(":")[1] || "image/png";
  
  const fileName = `${prefix}_${Date.now()}.png`;
  const s3Key = `uploads/reports/${fileName}`;

  const uploadCommand = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME!,
    Key: s3Key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3.send(uploadCommand);
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
}

/**
 * 1. 현장별 보고서 입력 양식 조회 API
 */
router.get("/work-sites/:id/report-form", async (req: Request, res: Response) => {
  try {
    const workSiteId = Number(req.params.id);
    const reportForm = await SiteReportForm.findOne({ where: { workSiteId } });

    if (!reportForm) {
      return res.status(200).json({ ok: true, data: { categories: ["기본"], textFields: [], imageFields: [] } }); 
    }

    return res.status(200).json({ ok: true, data: reportForm });
  } catch (error) {
    console.error("보고서 양식 조회 에러:", error);
    return res.status(500).json({ ok: false, message: "서버 오류가 발생했습니다." });
  }
});

/**
 * 2. 현장별 작업 보고서 양식 커스텀 설정 API
 */
router.post("/work-sites/:id/report-form", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const workSiteId = Number(req.params.id);
    const { categories, textFields, imageFields } = req.body;

    const site = await WorkSite.findByPk(workSiteId);
    if (!site) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "현장을 찾을 수 없습니다." });
    }

    let reportForm = await SiteReportForm.findOne({ where: { workSiteId }, transaction: tx });

    if (reportForm) {
      reportForm = await reportForm.update({ categories, textFields, imageFields }, { transaction: tx });
    } else {
      reportForm = await SiteReportForm.create({
        workSiteId,
        categories: categories || ["기본"],
        textFields: textFields || [],
        imageFields: imageFields || []
      }, { transaction: tx });
    }

    await tx.commit();
    return res.status(200).json({ ok: true, data: reportForm, message: "보고서 양식이 저장되었습니다." });

  } catch (error) {
    if (tx) await tx.rollback();
    console.error("보고서 양식 설정 에러:", error);
    return res.status(500).json({ ok: false, message: "양식 저장 중 서버 오류가 발생했습니다." });
  }
});

/**
 * 3. 💡 개별 작업 보고서 통합 저장 API (사진, 텍스트, 고객서명, 작성일자, 성명, '설문조사' 모두 처리)
 */
router.post("/work-items/:id/report", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const workItemId = Number(req.params.id);
    
    // 💡 2. 프론트엔드에서 보낸 데이터 추출에 surveyAnswers와 surveyId 추가!
    const { 
      textAnswers, 
      imageAnswers,
      surveyAnswers,     // 추가됨
      surveyId,          // 추가됨
      workerId, 
      customerSignature, 
      signDate, 
      signName 
    } = req.body; 

    if (!workerId) {
      await tx.rollback();
      return res.status(400).json({ ok: false, message: "작성자(workerId) 정보가 필요합니다." });
    }

    const item = await WorkItem.findByPk(workItemId, { transaction: tx });
    if (!item) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "작업을 찾을 수 없습니다." });
    }

    // --- 1. 보고서 사진 데이터 S3 업로드 처리 ---
    const processedImageAnswers: any = {};
    if (imageAnswers && typeof imageAnswers === "object") {
      for (const [key, value] of Object.entries(imageAnswers)) {
        if (typeof value === "string" && isBase64DataUrl(value)) {
          const uploadedUrl = await uploadBase64ImageToS3(value, `work_${workItemId}_${key.replace(/\s+/g, '_')}`);
          processedImageAnswers[key] = uploadedUrl;
        } else {
          processedImageAnswers[key] = value;
        }
      }
    }

    // --- 2. 고객 서명 S3 업로드 처리 ---
    let finalSignatureUrl = item.customerSignature;
    if (customerSignature && isBase64DataUrl(customerSignature)) {
      finalSignatureUrl = await uploadBase64ImageToS3(customerSignature, `signature_work_${workItemId}`);
    } else if (customerSignature === "") {
      finalSignatureUrl = null; 
    }

    // --- 3. WorkItem 업데이트 (서명, 날짜, 이름 및 상태 갱신) ---
    await item.update({
      customerSignature: finalSignatureUrl,
      workDate: signDate || item.workDate,
      customerName: signName || item.customerName,
      status: finalSignatureUrl ? "COMPLETED" : item.status
    }, { transaction: tx });

    // --- 4. 보고서 폼 데이터(SiteReportResult) 업데이트 ---
    let reportResult = await SiteReportResult.findOne({ where: { workItemId }, transaction: tx });

    if (reportResult) {
      reportResult = await reportResult.update({
        workerId,
        textAnswers,
        imageAnswers: processedImageAnswers
      }, { transaction: tx });
    } else {
      reportResult = await SiteReportResult.create({
        workItemId,
        workerId,
        textAnswers: textAnswers || {},
        imageAnswers: processedImageAnswers
      }, { transaction: tx });
    }

    // --- 5. 💡 설문 응답(SiteSurveyResponse) 저장 영역 ---
    // (올려주신 코드에 이 부분이 없어서 저장이 안 되었던 것입니다.)
    if (surveyAnswers) {
      const targetSurveyId = surveyId || 1; // 설문 폼 ID 매핑

      let existingSurvey = await SiteSurveyResponse.findOne({ where: { workItemId }, transaction: tx });
      
      if (existingSurvey) {
        // 이미 있으면 업데이트
        await existingSurvey.update({ 
          answers: surveyAnswers,
          siteSurveyId: targetSurveyId 
        }, { transaction: tx });
      } else {
        // 없으면 새로 생성
        await SiteSurveyResponse.create({ 
          workItemId, 
          siteSurveyId: targetSurveyId, 
          answers: surveyAnswers 
        }, { transaction: tx });
      }
    }

    // 모든 과정이 정상적으로 끝났을 때 DB에 반영(Commit)
    await tx.commit();

    // PDF 자동 생성
    try {
      const pdfUrl = await generateAndUploadReportPdf(reportResult.id);
      console.log(`[PDF 생성 완료] ${pdfUrl}`);
    } catch (pdfError) {
      console.error("[PDF 생성 에러]:", pdfError);
    }

    return res.status(200).json({ 
      ok: true, 
      data: reportResult, 
      message: "작업 보고서, 설문 응답, 서명이 성공적으로 저장되었습니다." 
    });

  } catch (error) {
    if (tx) await tx.rollback();
    console.error("작업 통합 저장 에러:", error);
    return res.status(500).json({ ok: false, message: "보고서 저장 중 서버 오류가 발생했습니다." });
  }
});

export default router;