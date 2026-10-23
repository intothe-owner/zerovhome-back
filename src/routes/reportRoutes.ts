import { Router, Request, Response } from "express";
import { sequelize } from "../config/database";
import { WorkSite } from "../models/WorkSite";
import { WorkItem } from "../models/WorkItem";
import { SiteReportForm } from "../models/SiteReportForm";
import { SiteReportResult } from "../models/SiteReportResult";
import { SiteSurveyResponse } from "../models/SiteSurveyResponse"; 
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { generateAndUploadReportPdf } from "../services/pdfService";
import sharp from "sharp"; // 👈 sharp 라이브러리 추가

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

// 💡 [수정됨] sharp를 이용해 업로드 전 이미지 리사이즈 및 압축 수행
async function uploadBase64ImageToS3(base64DataUrl: string, prefix: string): Promise<string> {
  const base64Data = base64DataUrl.replace(/^data:image\/\w+;base64,/, "");
  const originalBuffer = Buffer.from(base64Data, "base64");
  
  // 👈 sharp를 이용한 최적화 작업
  const optimizedBuffer = await sharp(originalBuffer)
    .rotate()
    .resize({ 
      width: 1280, // 가로 최대 1280px로 제한 (스마트폰 원본보다 작게 만들어 용량 대폭 감소)
      withoutEnlargement: true // 이미지가 1280px보다 작을 경우 억지로 키우지 않음
    })
    .jpeg({ quality: 90 }) // 시각적 퀄리티 저하를 느끼기 힘든 90% 수준의 고화질 JPEG로 변환
    .toBuffer();
  
  // 변환된 이미지에 맞춰 확장자와 ContentType 고정
  const fileName = `${prefix}_${Date.now()}.jpg`; 
  const s3Key = `uploads/reports/${fileName}`;

  const uploadCommand = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME!,
    Key: s3Key,
    Body: optimizedBuffer, // 👈 최적화된 버퍼 사용
    ContentType: "image/jpeg", // 👈 JPEG로 변환했으므로 타입 변경
  });

  await s3.send(uploadCommand);
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
}

// 기존 S3 파일 삭제 함수
async function deleteS3FileByUrl(fileUrl: string) {
  try {
    if (!fileUrl) return;
    const urlObj = new URL(fileUrl);
    const s3Key = urlObj.pathname.substring(1); 

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
      customerName: signName || item.customerName
    }, { transaction: tx });

    let reportResult = await SiteReportResult.findOne({ where: { workItemId }, transaction: tx });
    
    const oldPdfPath = reportResult?.pdfPath;

    if (reportResult) {
      reportResult = await reportResult.update({
        workerId,
        textAnswers,
        imageAnswers: processedImageAnswers,
        pdfPath: null
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

    res.status(200).json({ 
      ok: true, 
      data: reportResult, 
      message: "저장되었습니다. 새 PDF 파일을 생성 중입니다." 
    });

    generateAndUploadReportPdf(reportResult.id)
      .then(async (pdfUrl) => {
        console.log(`[백그라운드 PDF 생성 완료] ${pdfUrl}`);
        
        await SiteReportResult.update(
          { pdfPath: pdfUrl },
          { where: { id: reportResult.id } }
        );

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