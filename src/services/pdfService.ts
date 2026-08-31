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
  const hasSurvey = !!(surveyForm);
  
  const workDateStr = workItem.workDate || new Date().toISOString().split('T')[0];
  const [signYear, signMonth, signDay] = workDateStr.split('-');

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

  // 2. 카테고리별 PDF 생성
  for (const cat of categories) {
    let categoryImagesHtml = `<div class="photo-grid">`;
    
    imageFields.forEach((imgF: any) => {
      if (imgF.layout === 'FULL') {
        const key = `${cat}_${imgF.name}`;
        const imgUrl = imageAnswers[key];
        categoryImagesHtml += `
          <div class="photo-card-full">
            <div class="photo-title">${imgF.name}</div>
            <div class="photo-content">
              ${imgUrl ? `<img src="${imgUrl}" alt="${key}" />` : `<span class="empty-text">이미지 없음</span>`}
            </div>
          </div>
        `;
      } else {
        const key1 = `${cat}_${imgF.name} 1`, key2 = `${cat}_${imgF.name} 2`;
        const url1 = imageAnswers[key1], url2 = imageAnswers[key2];
        categoryImagesHtml += `<div class="photo-row">`;
        categoryImagesHtml += `
          <div class="photo-card-half">
            <div class="photo-title">${imgF.name} 1</div>
            <div class="photo-content">
              ${url1 ? `<img src="${url1}"/>` : `<span class="empty-text">이미지 없음</span>`}
            </div>
          </div>`;
        categoryImagesHtml += `
          <div class="photo-card-half">
            <div class="photo-title">${imgF.name} 2</div>
            <div class="photo-content">
              ${url2 ? `<img src="${url2}"/>` : `<span class="empty-text">이미지 없음</span>`}
            </div>
          </div>`;
        categoryImagesHtml += `</div>`;
      }
    });
    categoryImagesHtml += `</div>`;

    const signatureHtml = `
      <div class="signature-section">
        <div class="sig-date">${signYear} 년 &nbsp;&nbsp;&nbsp;&nbsp; ${signMonth} 월 &nbsp;&nbsp;&nbsp;&nbsp; ${signDay} 일</div>
        <div class="sig-name">
          성명: ${workItem.customerName || '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}
          <span class="sig-mark">
            (서명) ${workItem.customerSignature ? `<img src="${workItem.customerSignature}" />` : ''}
          </span>
        </div>
      </div>
    `;

    // 설문조사 문항 HTML 빌드
    let surveyQuestionsHtml = '';
    if (hasSurvey && surveyForm.questions) {
      if (!surveyResponse || !surveyResponse.answers || Object.keys(surveyResponse.answers).length === 0) {
        surveyQuestionsHtml = `
          <div class="no-data-text">설문 응답 데이터가 없습니다.</div>
          <div class="survey-subtitle">본 서비스에 대한 의견을 확인합니다.</div>
        `;
      } else {
        surveyQuestionsHtml = `<div class="survey-subtitle">본 서비스에 대한 의견을 확인합니다.</div>`;
        surveyQuestionsHtml += surveyForm.questions.map((q: any, i: number) => {
          const answer = surveyResponse.answers[i] || surveyResponse.answers[i.toString()];
          
          if (q.type === 'MULTIPLE_CHOICE' || q.options) {
            let optionsHtml = '<div class="survey-options">';
            q.options.forEach((opt: string) => {
              const isChecked = answer === opt ? 'checked' : '';
              optionsHtml += `
                <label class="survey-option">
                  <input type="radio" ${isChecked}> <span>${opt}</span>
                </label>
              `;
            });
            optionsHtml += '</div>';
            
            return `
              <div class="qa-box">
                <div class="q-title">${i + 1}. ${q.question}</div>
                ${optionsHtml}
              </div>
            `;
          } else {
            return `
              <div class="qa-box">
                <div class="q-title">${i + 1}. ${q.question}</div>
                <div class="a-text">${answer || '응답 없음'}</div>
              </div>
            `;
          }
        }).join('');
      }
    }

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
            -webkit-print-color-adjust: exact; 
            print-color-adjust: exact;
          }
          
          .page-1 { height: 100%; display: flex; flex-direction: column; justify-content: space-between; }

          .header { text-align: center; margin-bottom: 8px; border-bottom: 2px solid #222; padding-bottom: 6px; }
          .header h1 { margin: 0; font-size: 20px; }
          .header p { margin: 3px 0 0; color: #555; font-size: 12px; }
          
          table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; }
          th { background-color: #f4f4f4; width: 20%; text-align: center; }
          td { width: 30%; }

          .photo-grid { display: flex; flex-direction: column; gap: 8px; flex: 1; justify-content: flex-start; margin-bottom: 8px; }
          
          .photo-card-full, .photo-card-half { 
            border: 1px solid #ccc; padding: 4px; box-sizing: border-box; text-align: center; background: #fff;
          }
          .photo-card-full { width: 100%; }
          .photo-row { display: flex; justify-content: space-between; gap: 8px; }
          .photo-card-half { width: 48%; }
          
          .photo-title { margin: 0 0 4px 0; font-size: 12px; background: #f4f4f4; padding: 4px; font-weight: bold; border-bottom: 1px solid #ccc; }
          .photo-content { height: 160px; display: flex; align-items: center; justify-content: center; background: #fafafa; overflow: hidden; }
.photo-content img { width: 100%; height: 100%; object-fit: cover; }
          .empty-text { color: #888; font-size: 14px; font-weight: bold; }

          .signature-section { margin-top: auto; padding-top: 20px; text-align: right; font-size: 15px; border-top: 2px solid #222; }
          .sig-date { margin-bottom: 12px; font-weight: bold; letter-spacing: 1px; }
          .sig-name { font-weight: bold; position: relative; display: inline-block; padding-right: 90px; }
          .sig-mark { position: absolute; right: 0; top: 0; }
          .sig-mark img { position: absolute; right: -20px; top: -15px; height: 50px; }

          .page-2 { page-break-before: always; height: 100%; display: flex; flex-direction: column; justify-content: space-between; }
          .survey-content { flex: 1; display: flex; flex-direction: column; gap: 15px; margin-top: 15px; }
          .survey-subtitle { font-size: 14px; color: #555; margin-bottom: 10px; text-align: left; }
          .qa-box { margin-bottom: 10px; }
          .q-title { font-weight: bold; font-size: 14px; margin-bottom: 6px; }
          
          .survey-options { display: flex; flex-wrap: wrap; gap: 12px; font-size: 13px; margin-top: 4px; padding-left: 5px; }
          .survey-option { display: flex; align-items: center; gap: 4px; }
          .survey-option input[type="radio"] { appearance: none; -webkit-appearance: none; width: 14px; height: 14px; border: 1px solid #777; border-radius: 50%; margin: 0; display: inline-block; position: relative; }
          .survey-option input[type="radio"]:checked { border-color: #333; }
          .survey-option input[type="radio"]:checked::after { content: ''; width: 8px; height: 8px; background: #333; border-radius: 50%; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
          .a-text { font-size: 13px; color: #333; padding: 4px 8px; border-left: 2px solid #555; background: #f9f9f9; }
          .no-data-text { font-size: 14px; color: #888; font-weight: bold; margin-bottom: 20px; }
        </style>
      </head>
      <body>
        <div class="page-1">
          <div>
            <div class="header">
              <h1>${site.title} - ${cat} 작업 보고서</h1>
            </div>
            <table>
              <tr><th>고객명 / 장소</th><td>${workItem.customerName || '-'}</td><th>담당 작업자</th><td>${workItem.workerName || '미지정'}</td></tr>
              ${textHtml}
            </table>
            ${categoryImagesHtml}
          </div>

          ${!hasSurvey ? signatureHtml : `<div></div>`}
        </div>

        ${hasSurvey ? `
          <div class="page-2">
            <div>
              <div class="header">
                <h1>설문조사</h1>
              </div>
              <div class="survey-content">
                ${surveyQuestionsHtml}
              </div>
            </div>

            ${signatureHtml}
          </div>
        ` : ''}
      </body>
      </html>
    `;

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' as any } as any);
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await page.close();

    const fileName = `report_pdf_${workItem.id}_${cat}.pdf`;
    
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: `uploads/reports/pdfs/${fileName}`,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    });
    await s3.send(uploadCommand);
    
    pdfUrls[cat] = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/uploads/reports/pdfs/${fileName}?t=${Date.now()}`;
  }

  await browser.close();

  const finalPdfJson = JSON.stringify(pdfUrls);
  await report.update({ pdfPath: finalPdfJson });

  return finalPdfJson;
}