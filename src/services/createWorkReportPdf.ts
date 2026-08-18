import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import axios from "axios"; // axios 설치 필요 (npm install axios)
type SurveyChoice = {
  optionNo: number;
  optionText: string;
  selected: boolean;
};

type SurveyAnswer = {
  question: string;
  type: "multiple" | "subjective";
  answer: string;
  choices?: SurveyChoice[];
};

type CreatePdfParams = {
  title: string;
  name:string;
  agencyName: string;
  companyName: string;
  companyPhone: string;
  jobName: string;
  workDate: string;
  workerName: string;
  address: string;
  memo?: string;

  surveyTitle?: string;
  surveyIntro?: string;
  surveyMeta?: {
    year?: string;
    month?: string;
    day?: string;
    respondentName?: string;
    signaturePath?: string | null;
  };

  photos: {
    addressImage?: string | null;
    beforeImage?: string | null;
    duringImage?: string | null;
    afterImage?: string | null;
  };

  surveyAnswers: SurveyAnswer[];
};
/**
 * S3 URL 또는 로컬 경로에서 이미지 Buffer를 가져오는 함수
 */
async function getImageBuffer(imagePath: string | null | undefined): Promise<Buffer | null> {
  if (!imagePath) return null;

  try {
    // 1. S3 URL인 경우 (http로 시작)
    if (imagePath.startsWith("http")) {
      const response = await axios.get(imagePath, { responseType: "arraybuffer" });
      return Buffer.from(response.data, "binary");
    }

    // 2. 로컬 경로인 경우 (기존 방식 유지)
    const fullPath = path.resolve(process.cwd(), imagePath.replace(/^\/+/, ""));
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath);
    }

    return null;
  } catch (error) {
    console.error(`이미지 로드 실패 (${imagePath}):`, error);
    return null;
  }
}
// 예시: 사진 영역 그리기 (drawPhotoSection 등)
async function drawPhotoBlock(doc: PDFKit.PDFDocument, label: string, imgPath: string | null | undefined, x: number, y: number) {
  doc.font("NotoSansKR-Bold").fontSize(10).text(label, x, y);

  const buffer = await getImageBuffer(imgPath); // 이미지 버퍼 가져오기

  if (buffer) {
    doc.image(buffer, x, y + 15, { width: 220, height: 160 }); // 경로 대신 buffer 전달
  } else {
    doc.rect(x, y + 15, 220, 160).stroke();
    doc.font("NotoSansKR").fontSize(9).text("이미지 없음", x + 85, y + 90);
  }
}

function resolveUploadPath(filePath?: string | null) {
  if (!filePath) return null;
  const clean = filePath.replace(/^\/+/, "");
  return path.resolve(process.cwd(), clean);
}

function registerFonts(doc: PDFKit.PDFDocument) {
  const regularPath = path.resolve(
    process.cwd(),
    "assets/fonts/NotoSansKR-Regular.ttf"
  );
  const boldPath = path.resolve(
    process.cwd(),
    "assets/fonts/NotoSansKR-Bold.ttf"
  );

  if (!fs.existsSync(regularPath)) {
    throw new Error(`한글 폰트가 없습니다: ${regularPath}`);
  }

  doc.registerFont("NotoSansKR", regularPath);

  if (fs.existsSync(boldPath)) {
    doc.registerFont("NotoSansKR-Bold", boldPath);
  } else {
    doc.registerFont("NotoSansKR-Bold", regularPath);
  }

  doc.font("NotoSansKR");
}

function textOrDash(value?: string | null) {
  return value && String(value).trim() ? String(value) : "-";
}

// drawImageBox를 async 함수로 변경합니다.
async function drawImageBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  imagePath?: string | null
) {
  doc.font("NotoSansKR-Bold").fontSize(11).text(label, x, y - 18, {
    width: w,
    align: "center",
  });

  doc.rect(x, y, w, h).stroke();

  // getImageBuffer를 사용하여 S3 URL 또는 로컬 경로에서 이미지를 가져옵니다.
  const buffer = await getImageBuffer(imagePath);

  if (buffer) {
    try {
      doc.image(buffer, x + 6, y + 6, {
        fit: [w - 12, h - 12],
        align: "center",
        valign: "center",
      });
      return;
    } catch (err) {
      console.error("이미지 삽입 실패:", err);
    }
  }

  // 이미지가 없거나 로드에 실패했을 경우
  doc
    .font("NotoSansKR")
    .fontSize(10)
    .fillColor("#666")
    .text("이미지 없음", x, y + h / 2 - 8, {
      width: w,
      align: "center",
    })
    .fillColor("#000");
}

function drawInfoRow(
  doc: PDFKit.PDFDocument,
  y: number,
  label1: string,
  value1: string,
  label2: string,
  value2: string
) {
  const rowH = 34;

  doc.rect(40, y, 515, rowH).stroke();
  doc.moveTo(110, y).lineTo(110, y + rowH).stroke();
  doc.moveTo(315, y).lineTo(315, y + rowH).stroke();
  doc.moveTo(390, y).lineTo(390, y + rowH).stroke();

  doc.font("NotoSansKR-Bold").fontSize(11);
  doc.text(label1, 40, y + 10, { width: 70, align: "center" });
  doc.font("NotoSansKR").text(textOrDash(value1), 120, y + 10, {
    width: 180,
  });

  doc.font("NotoSansKR-Bold").text(label2, 320, y + 10, {
    width: 70,
    align: "center",
  });
  doc.font("NotoSansKR").text(textOrDash(value2), 400, y + 10, {
    width: 145,
  });

  return y + rowH;
}

function drawSurveyHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  intro: string,
  y: number
) {
  const titleBoxX = 60;
  const titleBoxY = y;
  const titleBoxW = 475;
  const titleBoxH = 30;

  // 1. 제목 영역
  doc.fillColor("#fef3c7").rect(titleBoxX, titleBoxY, titleBoxW, titleBoxH).fill();
  doc.fillColor("#000").font("NotoSansKR-Bold").fontSize(15).text(textOrDash(title), titleBoxX, titleBoxY + 7, {
    width: titleBoxW,
    align: "center",
    lineBreak: false,
  });

  y += titleBoxH + 10;

  // 2. 인사말 영역 (회색 박스)
  if (intro) {
    const introFontSize = 9.5;
    const padding = 12;
    const introTextWidth = 451; // 475 - (padding * 2)

    // [중요] 높이를 계산하기 전에 반드시 폰트와 크기를 먼저 설정해야 합니다!
    doc.font("NotoSansKR").fontSize(introFontSize);

    // 텍스트가 차지할 실제 높이 계산
    const textHeight = doc.heightOfString(intro, {
      width: introTextWidth,
      lineGap: 2, // 줄간격이 있다면 계산 시에도 포함
    });

    // 박스 높이 = 실제 글자 높이 + 상단 여백 + 하단 여백
    const introBoxHeight = textHeight + (padding * 2);

    // 배경 박스 그리기
    doc.fillColor("#f3f4f6").rect(60, y, 475, introBoxHeight).fill();

    // 인사말 텍스트 출력 (y + padding 위치에서 시작)
    doc.fillColor("#4b5563").text(intro, 60 + padding, y + padding, {
      width: introTextWidth,
      align: "left",
      lineGap: 2,
    });

    // 다음 항목을 위해 y 좌표를 박스 높이만큼 이동 (약간의 추가 간격 +10)
    y += introBoxHeight + 10;
  }

  return y;
}

function drawMultipleChoiceBlock(
  doc: PDFKit.PDFDocument,
  index: number,
  question: string,
  choices: SurveyChoice[],
  y: number
) {
  const pageBottom = 790; // 임계값 소폭 상향
  doc.font("NotoSansKR-Bold").fontSize(11); // 폰트 크기 살짝 조절

  const questionText = `${index}. ${textOrDash(question)}`;
  const titleHeight = doc.heightOfString(questionText, { width: 470, lineGap: 2 });

  const rows = Math.max(1, Math.ceil(choices.length / 3));
  const boxHeight = Math.max(50, rows * 22 + 20); // 박스 높이 최적화

  const topGap = 20;
  const bottomGap = 18; // 문항 간 간격 축소 (기존 25 -> 18)
  const needed = titleHeight + topGap + boxHeight + bottomGap;

  if (y + needed > pageBottom) {
    doc.addPage();
    y = 40;
  }

  doc.fillColor("#111827").text(questionText, 60, y, { width: 470, lineGap: 2 });
  y += titleHeight + topGap;

  doc.rect(60, y, 475, boxHeight).stroke();

  const startX = 76;
  const colWidth = 155;
  let row = 0;

  choices.forEach((choice, idx) => {
    const colIdx = idx % 3;
    const colX = startX + colIdx * colWidth;
    if (colIdx === 0 && idx > 0) row += 1;

    const itemY = y + 12 + row * 22;
    const mark = choice.selected ? "●" : "○";
    const text = `${mark} (${choice.optionNo}) ${choice.optionText}`;

    doc.font("NotoSansKR").fontSize(10).fillColor("#1f2937").text(text, colX, itemY, {
      width: 150,
      lineBreak: false,
    });
  });

  return y + boxHeight + bottomGap;
}

function drawSubjectiveBlock(
  doc: PDFKit.PDFDocument,
  index: number,
  question: string,
  answer: string,
  y: number
) {
  const pageBottom = 790;
  doc.font("NotoSansKR-Bold").fontSize(11);

  const questionText = `${textOrDash(question)} (기타)`;
  const titleHeight = doc.heightOfString(questionText, { width: 470, lineGap: 4});
  const answerTextHeight = doc.heightOfString(textOrDash(answer), { width: 450, lineGap: 4 });

  const boxHeight = Math.max(60, answerTextHeight + 20); // 박스 높이 최적화
  const topGap = 8;
  const bottomGap = 10;
  const needed = titleHeight + topGap + boxHeight + bottomGap;

  if (y + needed > pageBottom) {
    doc.addPage();
    y = 40;
  }

  doc.fillColor("#111827").text(questionText, 60, y, { width: 470, lineGap: 2 });
  y += titleHeight + topGap;

  doc.rect(60, y, 475, boxHeight).stroke();
  doc.font("NotoSansKR").fontSize(10).fillColor("#1f2937").text(textOrDash(answer), 72, y + 10, {
    width: 450,
    lineGap: 4,
  });

  return y + boxHeight + bottomGap;
}

// [수정] 서명 섹션 높이 대폭 압축
async function drawSurveyMetaAndSignature(
  doc: PDFKit.PDFDocument,
  params: CreatePdfParams,
  y: number
) {
  // 3페이지로 넘어가는 것을 방지하기 위해 임계값을 더 넉넉하게 잡습니다.
  if (y + 110 > 820) {
    doc.addPage();
    y = 80;
  }else {
    // 2. 이 부분에 간격 추가 (예: 40만큼 벌리기)
    // 서술식 블록이 끝난 지점부터 서명 섹션 시작점 사이의 여백이 됩니다.
    y += 80; 
  }

  // 회색 안내 바
  doc.fillColor("#f3f4f6").rect(60, y, 475, 25).fill();
  doc.fillColor("#1f2937").font("NotoSansKR-Bold").fontSize(10).text(
    "본 서비스에 대한 의견을 확인합니다.", 72, y + 7, { width: 450 }
  );

  y += 45; // 안내 바와 서명란 사이 간격

  const year = textOrDash(params.surveyMeta?.year);
  const month = textOrDash(params.surveyMeta?.month);
  const day = textOrDash(params.surveyMeta?.day);
  const name = textOrDash(params.surveyMeta?.respondentName);

  doc.font("NotoSansKR-Bold").fontSize(11).fillColor("#1f2937");

  // --- 날짜 영역 (밑줄 추가) ---
  let curX = 100;
  // 년
  doc.text(year, curX, y, { width: 50, align: "center" });
  doc.moveTo(curX, y + 15).lineTo(curX + 50, y + 15).stroke();
  doc.text("년", curX + 55, y);
  
  // 월
  curX += 85;
  doc.text(month, curX, y, { width: 35, align: "center" });
  doc.moveTo(curX, y + 15).lineTo(curX + 35, y + 15).stroke();
  doc.text("월", curX + 40, y);

  // 일
  curX += 70;
  doc.text(day, curX, y, { width: 35, align: "center" });
  doc.moveTo(curX, y + 15).lineTo(curX + 35, y + 15).stroke();
  doc.text("일", curX + 40, y);

  // --- 성명 영역 (밑줄 추가) ---
  curX += 85;
  doc.text("성명:", curX, y);
  doc.text(name, curX + 35, y, { width: 85, align: "center" });
  doc.moveTo(curX + 35, y + 15).lineTo(curX + 120, y + 15).stroke();

  // --- 서명 박스 (우측 끝 정렬 및 테두리 복구) ---
  const sigBoxW = 75;
  const sigBoxH = 50;
  const sigBoxX = 535 - sigBoxW; 
  const sigBoxY = y - 18;
  
  // 전체 사각형 그리기
  doc.rect(sigBoxX, sigBoxY, sigBoxW, sigBoxH).stroke();

  const sigBuffer = await getImageBuffer(params.surveyMeta?.signaturePath);
  if (sigBuffer) {
    doc.image(sigBuffer, sigBoxX + 2, sigBoxY + 2, {
      fit: [sigBoxW - 4, sigBoxH - 4],
      align: "center",
      valign: "center"
    });
  } else {
    doc.fontSize(8).fillColor("#999").text("(서명)", sigBoxX, sigBoxY + 20, { width: sigBoxW, align: "center" });
  }

  return y + 60;
}
function drawFullInfoRow(
  doc: PDFKit.PDFDocument,
  y: number,
  label: string,
  value: string
) {
  const rowH = 34;

  // 외곽선 그리기
  doc.rect(40, y, 515, rowH).stroke();
  // 라벨과 데이터 사이의 세로선만 그리기 (110 위치)
  doc.moveTo(110, y).lineTo(110, y + rowH).stroke();

  // 라벨 (왼쪽 1칸)
  doc.font("NotoSansKR-Bold").fontSize(11);
  doc.text(label, 40, y + 10, { width: 70, align: "center" });

  // 데이터 (오른쪽 3칸 병합 영역)
  doc.font("NotoSansKR").text(textOrDash(value), 120, y + 10, {
    width: 425, // 515 - 70 - 간격(약 20)
  });

  return y + rowH;
}
export async function createWorkReportPdfBuffer(
  params: CreatePdfParams
): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });


    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      registerFonts(doc);

      // 1페이지
      doc.font("NotoSansKR-Bold").fontSize(20).text(params.title, 40, 40, {
        width: 515,
        align: "center",
      });

      let y = 85;

      y = drawInfoRow(doc, y, "작업장소", params.address, "회사명", params.companyName);
      y = drawFullInfoRow(doc, y, "이름", params.name);
      y = drawInfoRow(doc, y, "공사명", params.jobName, "전화번호", params.companyPhone);
      y = drawInfoRow(doc, y, "작업일자", params.workDate, "서비스담당", params.workerName);


      y += 18;

      const boxW = 248;
      const gap = 20; // 사진 행(Row) 사이의 간격
      const pageBottom = 800; // A4 하단 여백을 고려한 마지노선 (A4 전체 높이는 약 842)

      /** * boxH 동적 계산 공식:
       * (현재y + boxH + 간격 + 라벨높이18 + boxH) = pageBottom 이 되어야 함
       */
      const boxH = (pageBottom - y - gap - 18) / 2;

      // 첫 번째 줄 (주소, 작업 전) - await 추가
      await drawImageBox(doc, 40, y, boxW, boxH, "주소 사진", params.photos.addressImage);
      await drawImageBox(doc, 307, y, boxW, boxH, "작업 전 사진", params.photos.beforeImage);

      // 두 번째 줄로 이동
      y += boxH + gap + 18;

      // 두 번째 줄 (작업 중, 작업 후) - await 추가
      await drawImageBox(doc, 40, y, boxW, boxH, "작업 중 사진", params.photos.duringImage);
      await drawImageBox(doc, 307, y, boxW, boxH, "작업 후 사진", params.photos.afterImage);

      // 2페이지
      doc.addPage();

      let surveyY = 40;
      surveyY = drawSurveyHeader(
        doc,
        params.surveyTitle || "설문조사",
        params.surveyIntro || "",
        surveyY
      );

      if (!params.surveyAnswers.length) {
        doc.font("NotoSansKR").fontSize(11).text("설문 응답 데이터가 없습니다.", 60, surveyY);
        surveyY += 30;
      } else {
        params.surveyAnswers.forEach((item, index) => {
          if (item.type === "multiple") {
            surveyY = drawMultipleChoiceBlock(
              doc,
              index + 1,
              item.question,
              item.choices ?? [],
              surveyY
            );
          } else {
            // if (params.memo) {
            //   // 기준점을 770에서 800으로 높이고, 여유 공간 체크를 120에서 80으로 완화
            //   if (surveyY + 80 > 800) {
            //     doc.addPage();
            //     surveyY = 40;
            //   }
              
            //   doc.font("NotoSansKR-Bold").fontSize(11).text("메모", 60, surveyY);
            //   surveyY += 15;

            //   const memoBoxHeight = 60; // 기존 80에서 60으로 축소
            //   doc.rect(60, surveyY, 475, memoBoxHeight).stroke();
            //   doc.font("NotoSansKR").fontSize(9).text(params.memo, 72, surveyY + 8, {
            //     width: 450,
            //     lineGap: 1,
            //   });
            // }
            surveyY = drawSubjectiveBlock(
              doc,
              index + 1,
              item.question,
              item.answer,
              surveyY
            );
          }
        });
      }

      surveyY = await drawSurveyMetaAndSignature(doc, params, surveyY);

      // if (params.memo) {
      //   // 기준점을 770에서 800으로 높이고, 여유 공간 체크를 120에서 80으로 완화
      //   if (surveyY + 80 > 800) {
      //     doc.addPage();
      //     surveyY = 40;
      //   }

      //   doc.font("NotoSansKR-Bold").fontSize(11).text("메모", 60, surveyY);
      //   surveyY += 15;

      //   const memoBoxHeight = 60; // 기존 80에서 60으로 축소
      //   doc.rect(60, surveyY, 475, memoBoxHeight).stroke();
      //   doc.font("NotoSansKR").fontSize(9).text(params.memo, 72, surveyY + 8, {
      //     width: 450,
      //     lineGap: 1,
      //   });
      // }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}