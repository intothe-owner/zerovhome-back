import puppeteer from "puppeteer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SiteReportResult } from "../models/SiteReportResult";
import { WorkItem } from "../models/WorkItem";
import { WorkSite } from "../models/WorkSite";
import { SiteSurveyResponse } from "../models/SiteSurveyResponse";
import { SiteSurvey } from "../models/SiteSurvey";
import { SiteReportForm } from "../models/SiteReportForm";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function generateAndUploadReportPdf(reportResultId: number): Promise<string> {
  const report = await SiteReportResult.findByPk(reportResultId, {
    include: [
      {
        model: WorkItem,
        as: "workItem",
        include: [
          { model: WorkSite, as: "site" },
          {
            model: SiteSurveyResponse,
            as: "surveyResponse",
            include: [{ model: SiteSurvey, as: "surveyForm" }]
          }
        ]
      }
    ]
  });

  if (!report || !report.workItem) throw new Error("보고서 데이터를 찾을 수 없습니다.");

  const workItem = report.workItem as any;
  const site = workItem.site;
  const textAnswers = report.textAnswers || {};
  const imageAnswers = report.imageAnswers || {};
  
  const surveyResponse = workItem.surveyResponse;
  const surveyForm = surveyResponse?.surveyForm;
  const hasSurvey = !!(surveyResponse && surveyForm);
  const workDateStr = workItem.workDate || new Date().toISOString().split('T')[0];

  const reportForm = await SiteReportForm.findOne({ where: { workSiteId: workItem.workSiteId } });
  let categories = reportForm?.categories || ["기본"];
  if (categories.length > 1 && categories.includes("기본")) {
    categories = categories.filter((c: string) => c !== "기본");
  }
  const textFields = reportForm?.textFields || [];
  const imageFields = reportForm?.imageFields || [];

  // 1. 공통 텍스트 필드 HTML 렌더링
  let textHtml = '';
  let halfBuffer: any[] = [];
  textFields.forEach((tf: any) => {
    const val = textAnswers[tf.name] || '-';
    if (tf.layout === 'FULL') {
      if (halfBuffer.length > 0) {
        textHtml += `<tr><th>${halfBuffer[0].name}</th><td colspan="3">${halfBuffer[0].val}</td></tr>`;
        halfBuffer = [];
      }
      textHtml += `<tr><th>${tf.name}</th><td colspan="3">${val}</td></tr>`;
    } else {
      halfBuffer.push({ name: tf.name, val });
      if (halfBuffer.length === 2) {
        textHtml += `<tr><th>${halfBuffer[0].name}</th><td>${halfBuffer[0].val}</td><th>${halfBuffer[1].name}</th><td>${halfBuffer[1].val}</td></tr>`;
        halfBuffer = [];
      }
    }
  });
  if (halfBuffer.length > 0) textHtml += `<tr><th>${halfBuffer[0].name}</th><td colspan="3">${halfBuffer[0].val}</td></tr>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const pdfUrls: Record<string, string> = {};

  // 2. 카테고리별로 루프를 돌며 각각 별도의 PDF 생성
  for (const cat of categories) {
    let categoryImagesHtml = `<div class="photo-grid">`;
    
    imageFields.forEach((imgF: any) => {
      if (imgF.layout === 'FULL') {
        const key = `${cat}_${imgF.name}`;
        if (imageAnswers[key]) {
          categoryImagesHtml += `
            <div class="photo-card-full">
              <div class="photo-title">${imgF.name}</div>
              <img src="${imageAnswers[key]}" alt="${key}" />
            </div>
          `;
        }
      } else {
        const key1 = `${cat}_${imgF.name} 1`, key2 = `${cat}_${imgF.name} 2`;
        const url1 = imageAnswers[key1], url2 = imageAnswers[key2];
        if (url1 || url2) {
          categoryImagesHtml += `<div class="photo-row">`;
          categoryImagesHtml += url1 ? `<div class="photo-card-half"><div class="photo-title">${imgF.name} 1</div><img src="${url1}"/></div>` : `<div class="photo-card-half empty"></div>`;
          categoryImagesHtml += url2 ? `<div class="photo-card-half"><div class="photo-title">${imgF.name} 2</div><img src="${url2}"/></div>` : `<div class="photo-card-half empty"></div>`;
          categoryImagesHtml += `</div>`;
        }
      }
    });
    categoryImagesHtml += `</div>`;

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="ko">
      <head>
        <meta charset="UTF-8">
        <title>${cat} 작업 완료 보고서</title>
        <style>
          @page { size: A4; margin: 10mm 12mm; }
          body { 
            font-family: 'Noto Sans KR', sans-serif; 
            color: #333; margin: 0; padding: 0; 
            box-sizing: border-box; 
            height: 277mm; 
            display: flex; flex-direction: column; justify-content: space-between;
          }
          
          .page-1 { height: 100%; display: flex; flex-direction: column; justify-content: space-between; }

          .header { text-align: center; margin-bottom: 8px; border-bottom: 2px solid #222; padding-bottom: 6px; }
          .header h1 { margin: 0; font-size: 20px; }
          .header p { margin: 3px 0 0; color: #555; font-size: 12px; }
          
          table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
          th, td { border: 1px solid #ccc; padding: 5px 8px; font-size: 12px; }
          th { background-color: #f4f4f4; width: 20%; text-align: center; }
          td { width: 30%; }

          .photo-grid { display: flex; flex-direction: column; gap: 6px; flex: 1; justify-content: center; margin-bottom: 8px; }
          
          .photo-card-full { width: 100%; border: 1px solid #ddd; padding: 4px; box-sizing: border-box; text-align: center; }
          .photo-card-full .photo-title { margin: 0 0 3px 0; font-size: 11px; background: #eee; padding: 3px; font-weight: bold; }
          .photo-card-full img { width: 100%; max-height: 120px; object-fit: contain; }

          .photo-row { display: flex; justify-content: space-between; gap: 8px; }
          .photo-card-half { width: 48%; border: 1px solid #ddd; padding: 4px; box-sizing: border-box; text-align: center; }
          .photo-card-half .photo-title { margin: 0 0 3px 0; font-size: 11px; background: #eee; padding: 3px; font-weight: bold; }
          .photo-card-half img { width: 100%; height: 110px; object-fit: contain; }
          .photo-card-half.empty { border: none; }

          .signature-box { text-align: right; padding-top: 6px; border-top: 1px dashed #ccc; font-size: 13px; }
          .signature-box p { margin: 2px 0; }

          /* 2페이지: 설문조사 전용 스타일 */
          .page-2 { page-break-before: always; height: 100%; display: flex; flex-direction: column; justify-content: space-between; }
          .survey-content { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 15px; }
          .qa-box { margin-bottom: 10px; }
          .q-title { font-weight: bold; font-size: 15px; margin-bottom: 5px; }
          .a-text { font-size: 14px; color: #4f46e5; padding-left: 12px; border-left: 3px solid #4f46e5; }
        </style>
      </head>
      <body>
        <!-- 1페이지: 작업 보고서 -->
        <div class="page-1">
          <div>
            <div class="header">
              <h1>${site.title} - ${cat} 작업 완료 보고서</h1>
              <p>작업일자: ${workDateStr}</p>
            </div>
            <table>
              <tr><th>고객명 / 장소</th><td>${workItem.customerName}</td><th>담당 작업자</th><td>${workItem.workerName || '미지정'}</td></tr>
              ${textHtml}
            </table>
            ${categoryImagesHtml}
          </div>

          <!-- 설문조사가 없을 때만 1페이지 하단에 서명 노출 -->
          ${!hasSurvey ? `
            <div class="signature-box">
              <p>날짜: ${workDateStr}</p>
              <p><strong>고객 확인 서명:</strong> ${workItem.customerSignature ? `<img src="${workItem.customerSignature}" style="height:40px; vertical-align:middle;"/>` : '(서명 없음)'}</p>
            </div>
          ` : `<div></div>`}
        </div>

        <!-- 2페이지: 설문조사 결과가 있을 때만 생성 (서명은 오직 이 2페이지 하단에만 노출) -->
        ${hasSurvey ? `
          <div class="page-2">
            <div>
              <div class="header">
                <h1>${surveyForm.title || '만족도 조사 결과'}</h1>
                ${surveyForm.description ? `<p>${surveyForm.description}</p>` : ''}
              </div>
              <div class="survey-content">
                ${surveyForm.questions.map((q: any, i: number) => `
                  <div class="qa-box">
                    <div class="q-title">Q${i + 1}. ${q.question}</div>
                    <div class="a-text">A. ${surveyResponse.answers[i] || surveyResponse.answers[i.toString()] || '응답 없음'}</div>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="signature-box">
              <p>날짜: ${workDateStr}</p>
              <p><strong>고객 확인 서명:</strong> ${workItem.customerSignature ? `<img src="${workItem.customerSignature}" style="height:40px; vertical-align:middle;"/>` : '(서명 없음)'}</p>
            </div>
          </div>
        ` : ''}
      </body>
      </html>
    `;

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' as any } as any);
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await page.close();

    // 💡 변경점 1: 파일명에서 Date.now() 제거. (항상 동일한 이름의 파일로 덮어쓰기)
    const fileName = `report_pdf_${workItem.id}_${cat}.pdf`;
    
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: `uploads/reports/pdfs/${fileName}`,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    });
    await s3.send(uploadCommand);
    
    // 💡 변경점 2: URL에 ?t=시간 쿼리를 붙여서 S3에는 덮어쓰지만 브라우저 캐시는 우회하도록 설정
    pdfUrls[cat] = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/reports/pdfs/${fileName}?t=${Date.now()}`;
  }

  await browser.close();

  const finalPdfJson = JSON.stringify(pdfUrls);
  await report.update({ pdfPath: finalPdfJson });

  return finalPdfJson;
}