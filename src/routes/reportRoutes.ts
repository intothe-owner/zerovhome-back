import { Router, Request, Response } from "express";
import { sequelize } from "../config/database";
import { WorkSite } from "../models/WorkSite";
import { WorkItem } from "../models/WorkItem";
import { SiteReportForm } from "../models/SiteReportForm";
import { SiteReportResult } from "../models/SiteReportResult";
import { SiteSurveyResponse } from "../models/SiteSurveyResponse"; 
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"; // 👈 DeleteObjectCommand 추가
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

// 💡 [새로 추가] 기존 S3 파일 삭제 함수
async function deleteS3FileByUrl(fileUrl: string) {
  try {
    if (!fileUrl) return;
    const urlObj = new URL(fileUrl);
    const s3Key = urlObj.pathname.substring(1); // 맨 앞의 '/' 제거

    const deleteCommand = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: decodeURIComponent(s3Key),
    });
    await s3.send(deleteCommand);
    console.log(`[S3 기존 파일 삭제 완료] ${s3Key}`);
  } catch (err) {
    console.error("[S3 기존 파일 삭제 실패]:", err);
  }
}

/**
 * 1. 현장별 보고서 입력 양식 조회 API
 */
router.get("/work-sites/:id/report-form", async (req: Request, res: Response) => {
  try {
    const workSiteId = Number(req.params.id);
    const reportForm = await SiteReportForm.findOne({ where: { workSiteId } });

    if (!reportForm) {
      return res.status(200).json({ ok: true, data: { categories: [], textFields: [], imageFields: [] } }); 
    }

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
      reportForm = await reportForm.update({ 
        categories: categories || [], 
        textFields: textFields || [], 
        imageFields: imageFields || [] 
      }, { transaction: tx });
    } else {
      reportForm = await SiteReportForm.create({
        workSiteId,
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
 * 3. 개별 작업 보고서 통합 저장 API
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

    const processedImageAnswers: Record<string, any> = {};
    if (imageAnswers && typeof imageAnswers === "object") {
      const uploadPromises = Object.entries(imageAnswers).map(async ([rawKey, value]) => {
        const key = rawKey as string;
        if (typeof value === "string" && isBase64DataUrl(value)) {
          const uploadedUrl = await uploadBase64ImageToS3(value, `work_${workItemId}_${key.replace(/\s+/g, '_')}`);
          return [key, uploadedUrl] as [string, string];
        }
        return [key, value] as [string, any]; 
      });

      const uploadedResults = await Promise.all(uploadPromises);
      for (const [key, val] of uploadedResults) {
        processedImageAnswers[key] = val;
      }
    }

    let finalSignatureUrl = item.customerSignature;
    if (customerSignature && isBase64DataUrl(customerSignature)) {
      finalSignatureUrl = await uploadBase64ImageToS3(customerSignature, `signature_work_${workItemId}`);
    } else if (customerSignature === "") {
      finalSignatureUrl = null; 
    }

    await item.update({
      customerSignature: finalSignatureUrl,
      workDate: signDate || item.workDate,
      customerName: signName || item.customerName,
      status: finalSignatureUrl ? "COMPLETED" : item.status
    }, { transaction: tx });

    let reportResult = await SiteReportResult.findOne({ where: { workItemId }, transaction: tx });
    
    // 💡 [핵심 수정] 새 문서를 저장하기 전 기존 PDF URL 기억해두기
    const oldPdfPath = reportResult?.pdfPath;

    if (reportResult) {
      reportResult = await reportResult.update({
        workerId,
        textAnswers,
        imageAnswers: processedImageAnswers,
        pdfPath: null // 👈 수정을 했으므로 기존 PDF 경로를 일시적으로 비워서 유저가 옛날 파일을 다운받지 못하게 방지
      }, { transaction: tx });
    } else {
      reportResult = await SiteReportResult.create({
        workItemId,
        workerId,
        textAnswers: textAnswers || {},
        imageAnswers: processedImageAnswers,
        pdfPath: null
      }, { transaction: tx });
    }

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

    // 💡 1. 사용자에게 빠른 응답 먼저 전달 (로딩창 제거)
    res.status(200).json({ 
      ok: true, 
      data: reportResult, 
      message: "저장되었습니다. 새 PDF 파일을 생성 중입니다." 
    });

    // 💡 2. 응답이 끝난 후 백그라운드에서 PDF 생성 및 S3 파일 교체 작업 실행
    generateAndUploadReportPdf(reportResult.id)
      .then(async (pdfUrl) => {
        console.log(`[백그라운드 PDF 생성 완료] ${pdfUrl}`);
        
        // 새로 만든 PDF URL 업데이트
        await SiteReportResult.update(
          { pdfPath: pdfUrl },
          { where: { id: reportResult.id } }
        );

        // 💡 3. 새 파일이 무사히 올라갔다면, 기존 S3 파일 완전히 삭제
        if (oldPdfPath) {
          await deleteS3FileByUrl(oldPdfPath);
        }
      })
      .catch((pdfError) => {
        console.error("[백그라운드 PDF 생성 에러]:", pdfError);
      });

  } catch (error) {
    if (tx) await tx.rollback();
    console.error("작업 통합 저장 에러:", error);
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, message: "보고서 저장 중 서버 오류가 발생했습니다." });
    }
  }
});

export default router;