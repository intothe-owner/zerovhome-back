import fs from "fs";
import path from "path";
import { Router, Request, Response } from "express";
import { sequelize } from "../config/database";
import { Survey, SurveyResponse, CleanUpHousehold } from "../models";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
const router = Router();

type QuestionType = "multiple" | "subjective";

type SaveSurveyQuestion =
  | {
    type: "multiple";
    question: string;
    options: [string, string, string, string, string];
  }
  | {
    type: "subjective";
    question: string;
  };

type SaveSurveyBody = {
  title: string;
  intro?: string | null;
  questions: SaveSurveyQuestion[];
};
type SubmitSurveyBody = {
  householdId: number;
  surveyId: number;
  surveyMonth: string;
  surveyDay: string;
  surveyName: string;
  signatureDataUrl: string;
  reportMemo: string;
  answers: Array<{
    questionId: number;
    type: "multiple" | "subjective";
    selectedOptionNo?: number | null;
    subjectiveAnswer?: string | null;
  }>;
};
function isValidQuestionType(value: unknown): value is QuestionType {
  return value === "multiple" || value === "subjective";
}

function validateSaveSurveyBody(body: any): { ok: true } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "잘못된 요청입니다." };
  }

  if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
    return { ok: false, message: "설문 제목을 입력해 주세요." };
  }

  if (!Array.isArray(body.questions) || body.questions.length === 0) {
    return { ok: false, message: "문항은 최소 1개 이상이어야 합니다." };
  }

  for (let i = 0; i < body.questions.length; i += 1) {
    const q = body.questions[i];

    if (!q || typeof q !== "object") {
      return { ok: false, message: `${i + 1}번 문항 형식이 올바르지 않습니다.` };
    }

    if (!isValidQuestionType(q.type)) {
      return { ok: false, message: `${i + 1}번 문항 타입이 올바르지 않습니다.` };
    }

    if (!q.question || typeof q.question !== "string" || !q.question.trim()) {
      return { ok: false, message: `${i + 1}번 문항 질문을 입력해 주세요.` };
    }

    if (q.type === "multiple") {
      if (!Array.isArray(q.options) || q.options.length !== 5) {
        return { ok: false, message: `${i + 1}번 객관식 문항은 보기 5개가 필요합니다.` };
      }

      for (let j = 0; j < q.options.length; j += 1) {
        const opt = q.options[j];
        if (typeof opt !== "string" || !opt.trim()) {
          return {
            ok: false,
            message: `${i + 1}번 문항의 ${j + 1}번 보기를 입력해 주세요.`,
          };
        }
      }
    }
  }

  return { ok: true };
}
//서명 저장
const signatureUploadDir = path.resolve(process.cwd(), "uploads", "survey-signatures");
fs.mkdirSync(signatureUploadDir, { recursive: true });
function isBase64SignatureDataUrl(data: string): boolean {
  return data.startsWith("data:image/");
}
async function uploadBase64SignatureToS3(dataUrl: string, householdId: number): Promise<string> {
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  const contentType = dataUrl.split(";")[0].split(":")[1] || "image/png";

  const fileName = `signature_${householdId}_${Date.now()}.png`;
  const s3Key = `uploads/signatures/${fileName}`;

  const uploadCommand = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME!,
    Key: s3Key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3.send(uploadCommand);

  // S3 전체 URL 반환
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
}
function saveBase64Signature(base64: string, householdId: number) {
  const match = base64.match(/^data:image\/png;base64,(.+)$/);
  if (!match) {
    throw new Error("서명 데이터 형식이 올바르지 않습니다.");
  }

  const buffer = Buffer.from(match[1], "base64");
  const filename = `survey_signature_${householdId}_${Date.now()}.png`;
  const fullPath = path.join(signatureUploadDir, filename);

  fs.writeFileSync(fullPath, buffer);
  return `/uploads/survey-signatures/${filename}`;
}
/**
 * POST /survey
 * 설문 저장
 */
router.post("/", async (req: Request, res: Response) => {
  const body = req.body as SaveSurveyBody;
  const validation = validateSaveSurveyBody(body);

  if (!validation.ok) {
    return res.status(400).json({
      message: validation.message,
    });
  }

  const tx = await sequelize.transaction();
  try {
    await Survey.update({ isActive: false }, { where: { isActive: true }, transaction: tx });

    // 질문과 보기를 한 번에 JSON으로 저장!
    const survey = await Survey.create({
        title: body.title.trim(),
        intro: body.intro?.trim() || null,
        questions: body.questions, // JSON 배열 그대로 저장
        isActive: true,
      }, { transaction: tx });

    await tx.commit();
    return res.status(201).json({ message: "설문이 저장되었습니다.", item: survey });
  } catch (err: any) {
    await tx.rollback();
    return res.status(500).json({ message: "저장 실패" });
  }

});

/**
 * GET /survey/active
 * 현재 활성 설문 조회
 */
router.get("/active", async (_req: Request, res: Response) => {
  try {
    const survey = await Survey.findOne({
      where: { isActive: true },
      order: [["id", "DESC"]]
    });

    if (!survey) return res.status(404).json({ message: "활성 설문이 없습니다." });

    // JSON 타입이므로 추가 조인 없이 그대로 응답
    return res.json({ item: survey });
  } catch (err: any) {
    return res.status(500).json({ message: "설문 조회 실패" });
  }
});
/**
 * DELETE /survey/active
 * 현재 활성 설문 초기화(삭제)
 */
router.delete("/active", async (_req: Request, res: Response) => {
  const tx = await sequelize.transaction();

  try {
    const survey = await Survey.findOne({
      where: { isActive: true },
      transaction: tx,
    });

    if (!survey) {
      await tx.rollback();
      return res.status(404).json({
        message: "초기화할 활성 설문이 없습니다.",
      });
    }

    await survey.destroy({ transaction: tx });

    await tx.commit();

    return res.json({
      message: "설문이 초기화되었습니다.",
    });
  } catch (err: any) {
    await tx.rollback();
    console.error(err);

    return res.status(500).json({
      message: "설문 초기화에 실패했습니다.",
      error: err?.message ?? String(err),
    });
  }
});
router.post("/submit", async (req: Request, res: Response) => {
  const body = req.body as SubmitSurveyBody;
  const tx = await sequelize.transaction();

  try {
    const householdId = Number(body.householdId);
    const surveyId = Number(body.surveyId);
    const surveyMonth = Number(body.surveyMonth);
    const surveyDay = Number(body.surveyDay);
    const surveyName = String(body.surveyName ?? "").trim();
    const signatureDataUrl = String(body.signatureDataUrl ?? "").trim();
    const answers = Array.isArray(body.answers) ? body.answers : [];

    // [기존 동일] S3 업로드 로직
    const base64Data = signatureDataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const contentType = signatureDataUrl.split(";")[0].split(":")[1];
    const fileName = `signature_${householdId}_${Date.now()}.png`;
    const s3Key = `uploads/signatures/${fileName}`;
    const reportMemo = String(body.reportMemo ?? "").trim();
    
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
    });
    await s3.send(uploadCommand);
    const finalSignatureUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

    // 기본 파라미터 체크 로직 (기존과 동일)
    if (!Number.isInteger(householdId) || householdId <= 0) { await tx.rollback(); return res.status(400).json({ message: "대상자 정보 오류" }); }
    if (!Number.isInteger(surveyId) || surveyId <= 0) { await tx.rollback(); return res.status(400).json({ message: "설문 정보 오류" }); }
    if (!surveyName) { await tx.rollback(); return res.status(400).json({ message: "성명을 입력해 주세요." }); }

    // ✅ 변경된 부분 1: include(조인) 제거! 단순히 Survey 테이블만 조회합니다.
    const survey = await Survey.findOne({
      where: { id: surveyId, isActive: true },
      transaction: tx,
    });

    if (!survey) {
      await tx.rollback();
      return res.status(404).json({ message: "활성 설문을 찾을 수 없습니다." });
    }

    const household = await CleanUpHousehold.findByPk(householdId, { transaction: tx });
    if (!household) {
      await tx.rollback();
      return res.status(404).json({ message: "대상자를 찾을 수 없습니다." });
    }

    let signaturePath = household.surveySignature ?? null;
    if (signatureDataUrl && isBase64SignatureDataUrl(signatureDataUrl)) {
      signaturePath = finalSignatureUrl;
    }
    if (!signaturePath) {
      await tx.rollback();
      return res.status(400).json({ message: "서명을 입력해 주세요." });
    }

    household.surveySignature = signaturePath;
    household.surveySubmittedAt = new Date();
    household.surveySubmittedByName = surveyName;
    await household.save({ transaction: tx });

    // ✅ 변경된 부분 2: SurveyResponse 하나에 JSON(answers) 통째로 저장!
    const responseData = {
      surveyId: survey.id,
      householdId: household.id,
      respondentName: surveyName,
      surveyYear: new Date().getFullYear(),
      surveyMonth,
      surveyDay,
      signaturePath,
      reportMemo,
      answers: answers, // 프론트엔드에서 넘어온 배열 그대로 JSON 컬럼에 밀어넣음
      submittedAt: new Date(),
    };

    const existingResponse = await SurveyResponse.findOne({
      where: { surveyId: survey.id, householdId: household.id },
      transaction: tx
    });

    let response = null;
    if (existingResponse) {
      // 수정 시 기존 복잡했던 자식 테이블 삭제 로직(destroy) 필요 없이 단순 덮어쓰기
      response = await existingResponse.update(responseData, { transaction: tx });
    } else {
      // 신규 생성
      response = await SurveyResponse.create(responseData, { transaction: tx });
    }

    // ✅ 변경된 부분 3: SurveyResponseAnswer 테이블에 bulkCreate 하던 긴 반복문 완전 삭제

    await tx.commit();

    return res.status(201).json({
      message: "설문 응답이 저장되었습니다.",
      item: {
        responseId: response.id,
        surveyId: response.surveyId,
        householdId: response.householdId,
        respondentName: response.respondentName,
        signaturePath: response.signaturePath,
        submittedAt: response.submittedAt,
      },
    });
  } catch (err: any) {
    await tx.rollback();
    console.error(err);
    return res.status(500).json({
      message: "설문 응답 저장에 실패했습니다.",
      error: err?.message ?? String(err),
    });
  }
});

/**
 * 특정 household의 가장 최근 설문 응답 조회
 */
router.get("/response/household/:householdId", async (req: Request, res: Response) => {
  try {
    const householdId = Number(req.params.householdId);

    if (!Number.isInteger(householdId) || householdId <= 0) {
      return res.status(400).json({
        message: "대상자 ID가 올바르지 않습니다.",
      });
    }

    const response = await SurveyResponse.findOne({
      where: { householdId },
      order: [["submittedAt", "DESC"]],
      include: [
        {
          model: Survey,
          as: "survey",
          include: [
            {
              model: Survey,
              as: "survey",
              // 💡 문항(questions)과 보기(options)는 이제 Survey 테이블의 JSON 컬럼으로 
              // 통째로 딸려오기 때문에 더 이상 하위 include가 필요 없습니다!
            },
            {
              model: CleanUpHousehold,
              as: "household",
              required: false,
            },
          ],
        },
      ],
    });

    if (!response) {
      return res.status(404).json({
        message: "저장된 설문 응답이 없습니다.",
      });
    }

    return res.json({
      item: response,
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({
      message: "설문 응답 조회에 실패했습니다.",
      error: err?.message ?? String(err),
    });
  }
});
export default router;