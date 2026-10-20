import puppeteer from "puppeteer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SiteReportResult } from "../models/SiteReportResult";
import { WorkItem } from "../models/WorkItem";
import { WorkSite } from "../models/WorkSite";
import { SiteReportForm } from "../models";

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
  
  // 💡 2. 현장에 설정된 폼 양식(Layout) 가져오기
  const reportForm = await SiteReportForm.findOne({ where: { workSiteId: workItem.workSiteId } });
  
  // JSON 파싱 방어 로직
  const textFields = reportForm?.textFields ? (typeof reportForm.textFields === 'string' ? JSON.parse(reportForm.textFields) : reportForm.textFields) : [];
  const imageFields = reportForm?.imageFields ? (typeof reportForm.imageFields === 'string' ? JSON.parse(reportForm.imageFields) : reportForm.imageFields) : [];
  const categories = reportForm?.categories ? (typeof reportForm.categories === 'string' ? JSON.parse(reportForm.categories) : reportForm.categories) : [];
  const validCategories = (categories.length > 0 && categories[0] !== '기본') ? categories : [''];

  // 💡 3. 텍스트 필드 HTML 생성 (HALF/FULL 레이아웃 반영)
  let textHtml = '';
  let i = 0;
  while (i < textFields.length) {
    const field1 = textFields[i];
    const val1 = textAnswers[field1.name] || '';

    if (field1.layout === 'HALF') {
      // 다음 필드도 HALF인지 확인하여 한 줄에 2개(4칸) 배치
      if (i + 1 < textFields.length && textFields[i+1].layout === 'HALF') {
        const field2 = textFields[i+1];
        const val2 = textAnswers[field2.name] || '';
        textHtml += `
          <tr>
            <th class="th-label">${field1.name}</th>
            <td class="td-value">${val1}</td>
            <th class="th-label">${field2.name}</th>
            <td class="td-value">${val2}</td>
          </tr>
        `;
        i += 2;
      } else {
        // 짝이 안 맞는 HALF 필드는 나머지 3칸을 병합
        textHtml += `
          <tr>
            <th class="th-label">${field1.name}</th>
            <td class="td-value" colspan="3">${val1}</td>
          </tr>
        `;
        i += 1;
      }
    } else {
      // FULL 필드는 한 줄 전체(3칸 병합) 사용
      textHtml += `
        <tr>
          <th class="th-label">${field1.name}</th>
          <td class="td-value" colspan="3">${val1}</td>
        </tr>
      `;
      i += 1;
    }
  }

  // 💡 4. 이미지 필드 HTML 생성 (여백 없이 100% 꽉 차게)
  let imageHtml = '';
  for (const cat of validCategories) {
    const catPrefix = cat ? `${cat}_` : '';
    const catDisplay = cat ? `[${cat}] ` : '';

    for (const field of imageFields) {
      if (field.layout === 'HALF') {
        const key1 = `${catPrefix}${field.name} 1`;
        const key2 = `${catPrefix}${field.name} 2`;
        const img1 = imageAnswers[key1];
        const img2 = imageAnswers[key2];

        // 사진이 하나라도 있는 경우에만 해당 행 렌더링
        if (img1 || img2) {
          imageHtml += `
            <tr class="image-header-row">
              <th colspan="2" class="th-image-label">${catDisplay}${field.name} 1</th>
              <th colspan="2" class="th-image-label">${catDisplay}${field.name} 2</th>
            </tr>
            <tr>
              <td colspan="2" class="td-image">${img1 ? `<img src="${img1}" />` : ''}</td>
              <td colspan="2" class="td-image">${img2 ? `<img src="${img2}" />` : ''}</td>
            </tr>
          `;
        }
      } else {
        const key = `${catPrefix}${field.name}`;
        const img = imageAnswers[key];

        if (img) {
          imageHtml += `
            <tr class="image-header-row">
              <th colspan="4" class="th-image-label">${catDisplay}${field.name}</th>
            </tr>
            <tr>
              <td colspan="4" class="td-image">${img ? `<img src="${img}" />` : ''}</td>
            </tr>
          `;
        }
      }
    }
  }

  // 5. 최종 HTML 템플릿 결합
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; margin: 0; padding: 0; color: #333; }
        
        .title { text-align: center; margin-bottom: 20px; font-size: 24px; font-weight: bold; letter-spacing: 1px; }
        
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { border: 1px solid #777; box-sizing: border-box; }
        
        /* 텍스트 영역 스타일 */
        .th-label { background-color: #f9f9f9; width: 18%; text-align: center; padding: 10px 5px; font-size: 13px; font-weight: normal; letter-spacing: 3px; }
        .td-value { width: 32%; padding: 10px 12px; font-size: 13px; }
        
        /* 이미지 영역 라벨 스타일 */
        .th-image-label { background-color: #fff; text-align: center; padding: 12px; font-size: 16px; font-weight: normal; }
        
        /* 💡 이미지 셀 100% 꽉 채우기 (여백 제거) */
        .td-image { padding: 0 !important; vertical-align: top; text-align: center; height: 350px; }
        .td-image img { width: 100%; height: 100%; object-fit: cover; display: block; margin: 0; }
        
        /* 고객 서명란 추가 */
        .sign-row th { background-color: #f9f9f9; text-align: center; padding: 15px 5px; font-size: 14px; font-weight: normal; letter-spacing: 5px; }
        .sign-row td { text-align: right; padding-right: 30px; font-size: 16px; font-weight: bold; position: relative; }
        .sign-img { height: 45px; position: absolute; right: 10px; top: 50%; transform: translateY(-50%); }
      </style>
    </head>
    <body>
      <!-- 첨부 이미지 형식의 제목 구성 -->
      <div class="title">${workItem?.customerName || ""} ${site?.title || ""} 작업보고서</div>
      
      <table>
        <tbody>
          <!-- 1. 텍스트 설정 영역 렌더링 -->
          ${textHtml}

          <!-- 2. 고객 서명 영역 (텍스트의 마지막에 자연스럽게 붙음) -->
          <tr class="sign-row">
            <th class="th-label">확 인 자</th>
            <td colspan="3">
               성명: ${workItem?.customerName || '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}
               ${workItem?.customerSignature ? `<img src="${workItem.customerSignature}" class="sign-img" />` : ''}
            </td>
          </tr>

          <!-- 3. 사진 설정 영역 렌더링 -->
          ${imageHtml}
        </tbody>
      </table>
    </body>
    </html>
  `;

  // 6. Puppeteer로 PDF 생성
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' as any } as any);
  const pdfBuffer = await page.pdf({ 
    format: 'A4', 
    printBackground: true,
    margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" }
  });
  
  await browser.close();

  // 7. S3 업로드
  const fileName = `report_pdf_${workItem.id}_${Date.now()}.pdf`;
  const s3Key = `uploads/reports/pdfs/${fileName}`;
  
  const uploadCommand = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME!,
    Key: s3Key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
  });
  
  await s3.send(uploadCommand);
  
  const finalPdfUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
  await report.update({ pdfPath: finalPdfUrl });

  return finalPdfUrl;
}
/*
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
}*/