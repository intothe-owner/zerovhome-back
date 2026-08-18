import PDFDocument from "pdfkit";
import axios from "axios";

type SeniorCenterPdfParams = {
  title: string;
  centerName: string;
  agencyName: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  ceoName: string;
  workDate: string;
  workerName: string;
  address: string;
  photos: {
    entranceImage?: string | null;
    workImage1?: string | null;
    workImage2?: string | null;
    beforeImage1?: string | null;
    afterImage1?: string | null;
    beforeImage2?: string | null;
    afterImage2?: string | null;
  };
};

async function getImageBuffer(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 5000 });
    return Buffer.from(res.data);
  } catch (e) {
    console.error("이미지 로드 실패:", url);
    return null;
  }
}

export async function createSeniorCenterReportPdfBuffer(params: SeniorCenterPdfParams): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const chunks: any[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const fontBold = "assets/fonts/NotoSansKR-Bold.ttf";
    const fontMedium = "assets/fonts/NotoSansKR-Regular.ttf";

    // --- 1. 제목 영역 ---
    doc.font(fontMedium).fontSize(20).text(`${params.title} (${params.centerName})`, 0, 40, { align: "center" });
  
    // --- 2. 상단 정보 표 ---
    const tableTop = 80;
    const doubleHeight = 50;  // 2배 높이 (1, 2행)
    const normalHeight = 25;  // 일반 높이 (3, 4행)
    
    const col1 = 40, col2 = 120, col3 = 330, col4 = 410;
    const tableWidth = 515;
    const totalTableHeight = (doubleHeight * 2) + (normalHeight * 2); // 150

    // 표 전체 테두리
    doc.lineWidth(0.8).rect(col1, tableTop, tableWidth, totalTableHeight).stroke();
    
    // 가로줄 위치 계산
    const row1Y = tableTop;
    const row2Y = row1Y + doubleHeight;
    const row3Y = row2Y + doubleHeight;
    const row4Y = row3Y + normalHeight;
    const tableBottom = tableTop + totalTableHeight;

    doc.moveTo(col1, row2Y).lineTo(col1 + tableWidth, row2Y).stroke(); 
    doc.moveTo(col1, row3Y).lineTo(col1 + tableWidth, row3Y).stroke(); 
    doc.moveTo(col1, row4Y).lineTo(col1 + tableWidth, row4Y).stroke(); 

    doc.font(fontMedium).fontSize(10);

    // Row 1 (50pt): 거래처명 / 회사명
    doc.text("거래처명", col1 + 10, row1Y + 18);
    doc.text(params.agencyName, col2 + 10, row1Y + 18);
    doc.text("회사명", col3 + 10, row1Y + 18);
    doc.text(params.companyName, col4 + 10, row1Y + 18);

    // Row 2 (50pt): 공사 명 / 주 소
    doc.text("공사 명", col1 + 10, row2Y + 18);
    doc.text(params.title, col2 + 10, row2Y + 18, { width: 200 });
    doc.text("주 소", col3 + 10, row2Y + 18);
    doc.text(params.companyAddress, col4 + 5, row2Y + 15, { width: 140 });

    // Row 3 (25pt): 작업 일자 / 전화번호
    doc.fontSize(10).text("작업 일자", col1 + 10, row3Y + 7);
    doc.text(params.workDate, col2 + 10, row3Y + 7);
    doc.text("전화번호", col3 + 10, row3Y + 7);
    doc.text(params.companyPhone, col4 + 10, row3Y + 7);

    // Row 4 (25pt): 작업 사진 / 작업자 / 대표
    doc.text("작업 사진", col1 + 10, row4Y + 7);
    doc.text(params.workerName, col2 + 10, row4Y + 7);
    doc.text("대표", col3 + 10, row4Y + 7);
    doc.text(params.ceoName, col4 + 10, row4Y + 7);

    // 세로 구분선
    doc.lineWidth(0.8);
    doc.moveTo(col2, tableTop).lineTo(col2, tableBottom).stroke();
    doc.moveTo(col3, tableTop).lineTo(col3, tableBottom).stroke();
    doc.moveTo(col4, tableTop).lineTo(col4, tableBottom).stroke();

    // --- 3. 사진 영역 (중앙 정렬 및 꽉 차게) ---
    const photoAreaTop = tableBottom + 35;
    const pageBottom = 800;
    const availableHeight = pageBottom - photoAreaTop;
    const photoBoxHeight = (availableHeight - 40) / 2;
    const photoBoxWidth = 250;
    const leftColX = 40;
    const rightColX = 305;

    // ✅ 반반 나눌 때 사용할 너비 미리 계산
    const halfWidth = (photoBoxWidth - 6) / 2;

    const drawPhotoTitle = (title: string, x: number, y: number, width: number) => {
      doc.font(fontBold).fontSize(11).text(title, x, y, { width: width, align: "center" });
    };

    // ✅ 모든 photos 접근에 옵셔널 체이닝(?.) 적용 완료
    // 1행 사진
    drawPhotoTitle("경로당 입구", leftColX, photoAreaTop - 15, photoBoxWidth);
    doc.rect(leftColX, photoAreaTop, photoBoxWidth, photoBoxHeight).stroke();
    const entImg = await getImageBuffer(params.photos?.entranceImage); 
    if(entImg) doc.image(entImg, leftColX + 2, photoAreaTop + 2, { width: photoBoxWidth - 4, height: photoBoxHeight - 4 });

    // ✅ 작업 진행 사진 (workImage1, workImage2 분할 출력)
    drawPhotoTitle("작업 진행 사진", rightColX, photoAreaTop - 15, photoBoxWidth);
    doc.rect(rightColX, photoAreaTop, photoBoxWidth, photoBoxHeight).stroke();
    const workImg1 = await getImageBuffer(params.photos?.workImage1);
    const workImg2 = await getImageBuffer(params.photos?.workImage2); // workImage2 추가 호출
    if(workImg1) doc.image(workImg1, rightColX + 2, photoAreaTop + 2, { width: halfWidth, height: photoBoxHeight - 4 });
    if(workImg2) doc.image(workImg2, rightColX + halfWidth + 4, photoAreaTop + 2, { width: halfWidth, height: photoBoxHeight - 4 });

    // 2행 사진
    const secondRowTop = photoAreaTop + photoBoxHeight + 35;

    drawPhotoTitle("작업 전/후 1", leftColX, secondRowTop - 15, photoBoxWidth);
    doc.rect(leftColX, secondRowTop, photoBoxWidth, photoBoxHeight).stroke();
    const b1 = await getImageBuffer(params.photos?.beforeImage1);
    const a1 = await getImageBuffer(params.photos?.afterImage1);

    if(b1) doc.image(b1, leftColX + 2, secondRowTop + 2, { width: halfWidth, height: photoBoxHeight - 4 });
    if(a1) doc.image(a1, leftColX + halfWidth + 4, secondRowTop + 2, { width: halfWidth, height: photoBoxHeight - 4 });

    drawPhotoTitle("작업 전/후 2", rightColX, secondRowTop - 15, photoBoxWidth);
    doc.rect(rightColX, secondRowTop, photoBoxWidth, photoBoxHeight).stroke();
    const b2 = await getImageBuffer(params.photos?.beforeImage2);
    const a2 = await getImageBuffer(params.photos?.afterImage2);
    if(b2) doc.image(b2, rightColX + 2, secondRowTop + 2, { width: halfWidth, height: photoBoxHeight - 4 });
    if(a2) doc.image(a2, rightColX + halfWidth + 4, secondRowTop + 2, { width: halfWidth, height: photoBoxHeight - 4 });

    doc.end();
  });
}