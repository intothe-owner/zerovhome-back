import puppeteer from "puppeteer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SiteReportResult } from "../models/SiteReportResult";
import { WorkItem } from "../models/WorkItem";
import { WorkSite } from "../models/WorkSite";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function generateAndUploadReportPdf(reportResultId: number): Promise<string> {
  // 1. DB에서 리포트 데이터 및 관계 데이터 조회
  const report = await SiteReportResult.findByPk(reportResultId, {
    include: [
      {
        model: WorkItem,
        as: "workItem",
        include: [{ model: WorkSite, as: "site" }]
      }
    ]
  });

  if (!report || !report.workItem) throw new Error("보고서 데이터를 찾을 수 없습니다.");

  const workItem = report.workItem as any;
  const site = workItem.site;
  const textAnswers = report.textAnswers || {};
  const imageAnswers = report.imageAnswers || {};
  
  // 2. 날짜 파싱
  const workDateStr = workItem.workDate || new Date().toISOString().split('T')[0];
  const [signYear, signMonth, signDay] = workDateStr.split('-');

  // 3. workItemRoutes에 있던 HTML 양식을 그대로 적용
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
        
        .signature-section { margin-top: 40px; padding-top: 20px; text-align: right; font-size: 15px; border-top: 2px solid #222; page-break-inside: avoid; }
        .sig-date { margin-bottom: 12px; font-weight: bold; letter-spacing: 1px; }
        .sig-name { font-weight: bold; position: relative; display: inline-block; padding-right: 90px; }
        .sig-mark { position: absolute; right: 0; top: 0; }
        .sig-mark img { position: absolute; right: -20px; top: -15px; height: 50px; }
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

      <div class="signature-section">
        <div class="sig-date">${signYear} 년 &nbsp;&nbsp;&nbsp;&nbsp; ${signMonth} 월 &nbsp;&nbsp;&nbsp;&nbsp; ${signDay} 일</div>
        <div class="sig-name">
          성명: ${workItem?.customerName || '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}
          <span class="sig-mark">
            (서명) ${workItem?.customerSignature ? `<img src="${workItem.customerSignature}" />` : ''}
          </span>
        </div>
      </div>
    </body>
    </html>
  `;

  // 4. Puppeteer로 1개의 PDF 생성
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' as any } as any);
  const pdfBuffer = await page.pdf({ 
    format: 'A4', 
    printBackground: true,
    margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" }
  });
  
  await browser.close();

  // 5. 생성된 1개의 PDF를 S3에 업로드
  const fileName = `report_pdf_${workItem.id}_${Date.now()}.pdf`;
  const s3Key = `uploads/reports/pdfs/${fileName}`;
  
  const uploadCommand = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME!,
    Key: s3Key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
  });
  
  await s3.send(uploadCommand);
  
  // 6. 1개의 S3 URL을 문자열로 반환
  const finalPdfUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
  
  // DB 업데이트
  await report.update({ pdfPath: finalPdfUrl });

  return finalPdfUrl;
}