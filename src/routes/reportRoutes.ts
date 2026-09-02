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
      // 💡 [수정됨] "기본" 텍스트 제거하고 무조건 빈 배열([]) 반환
      return res.status(200).json({ ok: true, data: { categories: [], textFields: [], imageFields: [] } }); 
    }

    // 💡 [핵심 방어 로직] DB에서 JSON 배열이 아닌 문자열로 반환될 경우를 대비해 파싱 처리
    let parsedCategories = reportForm.categories;
    let parsedTextFields = reportForm.textFields;
    let parsedImageFields = reportForm.imageFields;
    
    if (typeof parsedCategories === 'string') parsedCategories = JSON.parse(parsedCategories);
    if (typeof parsedTextFields === 'string') parsedTextFields = JSON.parse(parsedTextFields);
    if (typeof parsedImageFields === 'string') parsedImageFields = JSON.parse(parsedImageFields);

    return res.status(200).json({ 
      ok: true, 
      data: {
        ...reportForm.toJSON(),
        categories: parsedCategories || [],
        textFields: parsedTextFields || [],
        imageFields: parsedImageFields || []
      }
    });
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
      // 💡 배열로 명확히 업데이트
      reportForm = await reportForm.update({ 
        categories: categories || [], 
        textFields: textFields || [], 
        imageFields: imageFields || [] 
      }, { transaction: tx });
    } else {
      reportForm = await SiteReportForm.create({
        workSiteId,
        // 💡 [수정됨] "기본" 텍스트 덮어쓰기 로직 제거
        categories: categories || [],
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
 * 3. 개별 작업 보고서 통합 저장 API (사진, 텍스트, 고객서명, 작성일자, 성명, '설문조사' 모두 처리)
 */
router.post("/work-items/:id/report", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const workItemId = Number(req.params.id);
    
    const { 
      textAnswers, 
      imageAnswers,
      surveyAnswers,     
      surveyId,          
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

    // --- 5. 설문 응답(SiteSurveyResponse) 저장 영역 ---
    const hasSurveyData = surveyAnswers && Object.keys(surveyAnswers).length > 0;

    if (surveyId && hasSurveyData) {
      let existingSurvey = await SiteSurveyResponse.findOne({ where: { workItemId }, transaction: tx });
      
      if (existingSurvey) {
        await existingSurvey.update({ 
          answers: surveyAnswers,
          siteSurveyId: surveyId 
        }, { transaction: tx });
      } else {
        await SiteSurveyResponse.create({ 
          workItemId, 
          siteSurveyId: surveyId, 
          answers: surveyAnswers 
        }, { transaction: tx });
      }
    }

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