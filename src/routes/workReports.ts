// src/routes/work-reports.ts
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { sequelize } from "../config/database";
import { CleanUpHousehold, SurveyResponse, Survey } from "../models";
import { createWorkReportPdfBuffer } from "../services/createWorkReportPdf";
import moment from "moment";
import { makeSafePdfFileName, encodeRFC5987ValueChars } from "../utils/fileName";

const router = Router();



function formatDate(value?: string | null) {
  if (!value) return "-";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${y}. ${m}. ${d}.`;
}

function getHouseholdAddress(household: any) {
  return [household?.roadAddress, household?.detailAddress]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function getAnswerText(question: any, answer: any) {
  if (!answer) return "-";

  if (answer.subjectiveAnswer) {
    return answer.subjectiveAnswer;
  }

  if (answer.selectedOptionNo != null && Array.isArray(question?.options)) {
    const selected = question.options.find(
      (opt: any) => opt.optionNo === answer.selectedOptionNo
    );
    return selected?.optionText ?? "-";
  }

  return "-";
}

/**
 * 최신 작업보고서 조회
 * GET /work-reports/household/:householdId/latest
 */
router.get("/household/:householdId/latest", async (req: Request, res: Response) => {
  try {
    // 1. 파라미터를 숫자로 변환하여 타입 에러 해결 및 안전성 확보
    const householdId = Number(req.params.householdId);

    // 2. 유효한 숫자인지 체크 (기존에 작성하셨던 좋은 방어 로직)
    if (!Number.isInteger(householdId) || householdId <= 0) {
      return res.status(400).json({ message: "유효하지 않은 대상자 ID 입니다." });
    }

    // 3. 숫자로 변환된 ID를 findByPk에 전달
    const household = await CleanUpHousehold.findByPk(householdId);
    
    if (!household) {
      return res.status(404).json({ message: "저장된 데이터가 없습니다." });
    }

    // 호환성을 위해 item 랩핑
    return res.json({ item: household });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ message: "조회 실패" });
  }
});

// /**
//  * 저장된 PDF 다운로드
//  * GET /work-reports/:id/download
//  */
// router.get("/:id/download", async (req: Request, res: Response) => {
//   try {
//     const id = Number(req.params.id);

//     if (!Number.isInteger(id) || id <= 0) {
//       return res.status(400).json({ message: "유효하지 않은 ID입니다." });
//     }

//     const item = await WorkReport.findByPk(id);

//     if (!item) {
//       return res.status(404).json({ message: "작업보고서를 찾을 수 없습니다." });
//     }

//     if (!item.pdfPath) {
//       return res.status(404).json({ message: "저장된 PDF가 없습니다." });
//     }

//     const absolutePath = path.resolve(
//       process.cwd(),
//       item.pdfPath.replace(/^\/+/, "")
//     );

//     if (!fs.existsSync(absolutePath)) {
//       return res.status(404).json({ message: "PDF 파일이 존재하지 않습니다." });
//     }

//     const title = makeSafePdfFileName(
//       makeWorkReportTitle(item.dongName, item.residentName)
//     );

//     res.setHeader("Content-Type", "application/pdf");
//     res.setHeader(
//       "Content-Disposition",
//       `attachment; filename="work-report.pdf"; filename*=UTF-8''${encodeRFC5987ValueChars(
//         title
//       )}`
//     );

//     return fs.createReadStream(absolutePath).pipe(res);
//   } catch (error: any) {
//     console.error(error);
//     return res.status(500).json({
//       message: error?.message || "PDF 다운로드에 실패했습니다.",
//     });
//   }
// });

/**
 * 작업보고서 생성 + PDF 생성 + DB 저장 + 즉시 다운로드
 * POST /work-reports/household/:householdId/pdf
 */
router.post("/:householdId/pdf", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const householdId = Number(req.params.householdId);
    const body = req.body;

    const household = await CleanUpHousehold.findByPk(householdId, { transaction: tx });
    if (!household) throw new Error("대상자 없음");

    let safeWorkDate = body.workDate;
    if (!safeWorkDate || !moment(safeWorkDate).isValid()) safeWorkDate = moment().format("YYYY-MM-DD"); 

    // 기존 WorkReport 역할을 이제 CleanUpHousehold 가 직접 수행 (업데이트)
    await household.update({
        workerName: body.workerName,
        workDate: safeWorkDate,
        reportMemo: body.memo ?? null,
    }, { transaction: tx });

    // 설문 응답 조회 (JSON 데이터 활용)
    const surveyResponse = await SurveyResponse.findOne({
      where: { householdId },
      order: [["submittedAt", "DESC"]],
      include: [{ model: Survey, as: "survey" }],
      transaction: tx,
    });

    const responseInfo = surveyResponse as any;

    const surveyAnswers: any[] = [];
    
    // getDataValue 대신 직접 프로퍼티로 접근합니다.
    const surveyInfo = responseInfo?.survey;
    const questionsJSON = surveyInfo?.questions || [];
    const answersJSON = responseInfo?.answers || [];

    // JSON 배열을 매핑하여 PDF 생성용 객체 생성
    for (const q of questionsJSON) {
      const matched = answersJSON.find((a: any) => a.questionId === q.id);
      
      let answerText = "-";
      let choices = [];
      if (q.type === "multiple" && matched) {
         const selectedOpt = q.options?.find((opt:any) => opt.optionNo === matched.selectedOptionNo);
         answerText = selectedOpt ? selectedOpt.optionText : "-";
         choices = q.options?.map((opt:any) => ({
             optionNo: opt.optionNo, optionText: opt.optionText, selected: matched.selectedOptionNo === opt.optionNo
         }));
      } else if(q.type === "subjective" && matched) {
         answerText = matched.subjectiveAnswer || "-";
      }

      surveyAnswers.push({
        question: q.question, type: q.type, answer: answerText, choices
      });
    }

    const title = '해운대구 취약계층 에어컨 클린UP 작업사진';
    
    // PDF 버퍼 생성
    const pdfBuffer = await createWorkReportPdfBuffer({
      title,
      name: household.name,
      agencyName: household.dong,
      companyName: "(주)제로브이",
      companyPhone: "051-545-1150",
      jobName: '해운대구 취약계층 에어클린 UP',
      workDate: moment(safeWorkDate).format('YYYY.MM.DD'),
      workerName: body.workerName,
      address: `${household.roadAddress} ${household.detailAddress || ''}`.trim(),
      memo: household.reportMemo || "",
      surveyTitle: surveyInfo?.title || "설문조사",
      surveyIntro: surveyInfo?.intro || "",
      surveyMeta: {
        year: String(new Date().getFullYear()),
        // 💡 해결책: any로 캐스팅한 responseInfo에서 바로 꺼내어 씁니다.
        // 혹시 DB에 값이 없을 경우를 대비해 submittedAt에서 날짜를 뽑아오는 폴백(Fallback)도 추가했습니다.
        month: responseInfo?.surveyMonth ? String(responseInfo.surveyMonth) : (responseInfo?.submittedAt ? String(new Date(responseInfo.submittedAt).getMonth() + 1) : ""),
        day: responseInfo?.surveyDay ? String(responseInfo.surveyDay) : (responseInfo?.submittedAt ? String(new Date(responseInfo.submittedAt).getDate()) : ""),
        respondentName: responseInfo?.respondentName || "",
        signaturePath: responseInfo?.signaturePath || null,
      },
      photos: {
        addressImage: household.addressImage, beforeImage: household.beforeImage,
        duringImage: household.duringImage, afterImage: household.afterImage,
      },
      surveyAnswers,
    });

    await tx.commit();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeRFC5987ValueChars(makeSafePdfFileName(title))}`);
    return res.send(pdfBuffer);
  } catch (error: any) {
    await tx.rollback();
    return res.status(500).json({ message: "오류 발생" });
  }
});

export default router;