import { Router, Request, Response } from "express";
import { Op, Transaction } from "sequelize";
import multer from "multer";
import XLSX from "xlsx";
import { sequelize } from "../config/database";
import { Question } from "../models/Question";
import { ExamSession } from "../models/ExamSession";
import { UserAnswer } from "../models/UserAnswer";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB 제한
});

// ==========================================
// 1. 문제(Question) 엑셀 업로드 및 CRUD
// ==========================================

router.get("/categories", async (req: Request, res: Response) => {
  try {
    // DB에 등록된 중복 없는 회차명(examTitle)만 추출
    const categories = await Question.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('examTitle')), 'examTitle']],
      order: [['examTitle', 'DESC']]
    });
    
    const categoryList = categories.map(c => c.getDataValue('examTitle'));
    return res.status(200).json({ ok: true, data: categoryList });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "카테고리 목록 조회 실패" });
  }
});
router.get("/exams/:sessionId/random-test", async (req: Request, res: Response) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const session = await ExamSession.findByPk(sessionId);
    
    if (!session) {
      return res.status(404).json({ ok: false, message: "세션을 찾을 수 없습니다." });
    }

    const selectedExamTitle = session.getDataValue('examTitle');

    // 선택한 카테고리(examTitle)에 해당하는 문제만 랜덤으로 60개 추출
    const questions = await Question.findAll({
      where: { examTitle: selectedExamTitle },
      order: sequelize.random(),
      limit: 60
    });

    if (questions.length === 0) {
      return res.status(404).json({ ok: false, message: "해당 회차에 등록된 문제가 없습니다." });
    }

    // 보기 셔플 로직 (기존과 동일)
    const randomizedQuestions = questions.map((q) => {
      const qData = q.get({ plain: true });
      const originalOptions = qData.options;
      const originalAnswerIdx = qData.answer;
      const correctText = originalOptions[originalAnswerIdx];

      const shuffledOptions = [...originalOptions];
      for (let i = shuffledOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
      }

      const newAnswerIdx = shuffledOptions.indexOf(correctText);

      return {
        ...qData,
        options: shuffledOptions,
        answer: newAnswerIdx 
      };
    });

    return res.status(200).json({ ok: true, count: randomizedQuestions.length, data: randomizedQuestions });
  } catch (error) {
    console.error("랜덤 모의고사 생성 에러:", error);
    return res.status(500).json({ ok: false, message: "모의고사 생성 중 오류 발생" });
  }
});

/**
 * 엑셀 파일 업로드하여 문제 일괄 등록
 */
router.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
  let tx: Transaction | null = null;
  try {
    const { examTitle } = req.body; // 예: "전기기능사 1회"
    if (!examTitle) return res.status(400).json({ ok: false, message: "시험 회차명(examTitle)이 필요합니다." });
    if (!req.file) return res.status(400).json({ ok: false, message: "엑셀 파일이 없습니다." });

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (rawRows.length === 0) {
      return res.status(400).json({ ok: false, message: "데이터가 비어있습니다." });
    }

    tx = await sequelize.transaction();
    const parsedItems = [];
    const errors: string[] = [];
    
    // 정답 기호를 인덱스로 매핑
    const ansMap: Record<string, number> = { '①': 0, '②': 1, '③': 2, '④': 3 };

    for (const [index, row] of rawRows.entries()) {
      try {
        const questionNumber = Number(row['번호']) || index + 1;
        const content = String(row['문제'] || "").trim();
        const options = [
          String(row['①'] || "").trim(),
          String(row['②'] || "").trim(),
          String(row['③'] || "").trim(),
          String(row['④'] || "").trim()
        ];
        const answerSymbol = String(row['정답'] || "").trim();
        const answerIdx = ansMap[answerSymbol] ?? 0;
        const explanation = String(row['해설'] || "").trim();

        if (content) {
          parsedItems.push({
            examTitle,
            questionNumber,
            content,
            options,
            answer: answerIdx,
            explanation,
          });
        }
      } catch (err) {
        errors.push(`${index + 2}행 파싱 오류`);
      }
    }

    await Question.bulkCreate(parsedItems, { transaction: tx });
    await tx.commit();

    return res.status(200).json({ ok: true, total: rawRows.length, saved: parsedItems.length, errors });
  } catch (error) {
    if (tx) await tx.rollback();
    console.error("문제 엑셀 업로드 에러:", error);
    return res.status(500).json({ ok: false, message: "엑셀 처리 중 서버 오류가 발생했습니다." });
  }
});
router.get("/exams/random-test", async (req: Request, res: Response) => {
  try {
    // 1. DB에서 60문제를 무작위로 추출 (DB 레벨의 랜덤 정렬 활용)
    const questions = await Question.findAll({
      order: sequelize.random(), // MySQL의 경우 RAND(), PostgreSQL은 RANDOM() 으로 자동 변환됨
      limit: 60
    });

    // 만약 DB에 저장된 총 문제가 60개 미만일 경우를 대비한 예외 처리
    if (questions.length === 0) {
      return res.status(404).json({ ok: false, message: "등록된 문제가 없습니다." });
    }

    // 2. 추출된 60문제의 '보기 배열'을 각각 섞고, '정답 번호'를 새롭게 맞춤
    const randomizedQuestions = questions.map((q) => {
      // Sequelize 모델 객체를 순수 JSON(Plain Object)으로 변환
      const qData = q.get({ plain: true });
      
      const originalOptions = qData.options; // 예: ["전압", "전류", "저항", "전력"]
      const originalAnswerIdx = qData.answer; // 예: 2 (저항)
      const correctText = originalOptions[originalAnswerIdx]; // 정답 텍스트 ("저항") 백업

      // 보기 배열 랜덤 셔플 (Fisher-Yates 알고리즘)
      const shuffledOptions = [...originalOptions];
      for (let i = shuffledOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
      }

      // 섞인 보기 배열에서 원래 정답 텍스트가 몇 번째(index)로 이동했는지 추적
      const newAnswerIdx = shuffledOptions.indexOf(correctText);

      // 섞인 데이터로 덮어씌워서 클라이언트에 전달
      return {
        ...qData,
        options: shuffledOptions,
        answer: newAnswerIdx 
      };
    });

    return res.status(200).json({ 
      ok: true, 
      count: randomizedQuestions.length,
      data: randomizedQuestions 
    });
  } catch (error) {
    console.error("랜덤 모의고사 생성 에러:", error);
    return res.status(500).json({ ok: false, message: "모의고사 생성 중 서버 오류가 발생했습니다." });
  }
});
/**
 * 문제 목록 조회 (페이징, 시험 회차별 필터링)
 */
router.get("", async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 20;
    const examTitle = req.query.examTitle as string;

    const where = examTitle ? { examTitle } : {};
    const offset = (page - 1) * pageSize;

    const { count, rows } = await Question.findAndCountAll({
      where,
      order: [["examTitle", "DESC"], ["questionNumber", "ASC"]],
      offset,
      limit: pageSize,
    });

    return res.status(200).json({ ok: true, data: rows, total: count });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "목록 조회 실패" });
  }
});

/**
 * 문제 단건 등록
 */
router.post("", async (req: Request, res: Response) => {
  try {
    const newQuestion = await Question.create(req.body);
    return res.status(201).json({ ok: true, data: newQuestion });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "문제 등록 실패" });
  }
});

/**
 * 문제 수정
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const question = await Question.findByPk(Number(req.params.id));
    if (!question) return res.status(404).json({ ok: false, message: "문제를 찾을 수 없습니다." });

    await question.update(req.body);
    return res.status(200).json({ ok: true, data: question });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "수정 중 오류 발생" });
  }
});

/**
 * 문제 삭제
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const question = await Question.findByPk(Number(req.params.id));
    if (!question) return res.status(404).json({ ok: false, message: "문제를 찾을 수 없습니다." });

    await question.destroy(); // paranoid 옵션이 켜져 있으면 Soft Delete 됨
    return res.status(200).json({ ok: true, message: "삭제되었습니다." });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "삭제 중 오류 발생" });
  }
});

// ==========================================
// 2. 시험 풀이(Exam Session) 및 채점 결과 반환
// ==========================================

/**
 * 시험 시작 (세션 생성)
 */
/**
 * 시험 시작 (응시 기록 생성)
 */
router.post("/exams/start", async (req: Request, res: Response) => {
  try {
    const { examTitle } = req.body;
    
    // 타이틀이 안 넘어오면 기본값 설정
    const title = examTitle || "전기기능사 랜덤 모의고사";

    // 사용자 정보 없이 순수하게 응시 기록만 생성
    const session = await ExamSession.create({
      examTitle: title,
      startedAt: new Date()
    });

    return res.status(201).json({ 
      ok: true, 
      data: session, 
      message: "시험이 시작되었습니다." 
    });
  } catch (error) {
    console.error("시험 시작 에러:", error);
    return res.status(500).json({ ok: false, message: "시험 시작 실패" });
  }
});

/**
 * 개별 답안 제출 (또는 전체 답안 일괄 제출)
 */
router.post("/exams/:sessionId/answers", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const sessionId = Number(req.params.sessionId);
    const { answers } = req.body; 

    const session = await ExamSession.findByPk(sessionId);
    if (!session) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "세션을 찾을 수 없습니다." });
    }

    const answerRecords = [];
    
    for (const ans of answers) {
      const question = await Question.findByPk(ans.questionId);
      if (!question) continue;

      // 1. DB의 원본 정답 텍스트 찾기
      const originalOptions = question.getDataValue('options');
      const originalAnswerIdx = question.getDataValue('answer');
      const correctText = originalOptions[originalAnswerIdx];

      // 2. 사용자가 본 '섞인 보기' 배열에서 원본 정답 텍스트가 몇 번째인지 찾기
      const newCorrectIdx = ans.shuffledOptions.indexOf(correctText);
      
      // 3. 사용자가 선택한 번호와 섞인 보기의 정답 번호가 일치하는지 확인
      const isCorrect = (ans.submittedAnswer === newCorrectIdx);

      answerRecords.push({
        sessionId: session.getDataValue('id'),
        questionId: question.getDataValue('id'),
        submittedAnswer: ans.submittedAnswer,
        shuffledOptions: ans.shuffledOptions, // 사용자가 본 보기 그대로 저장
        correctAnswer: newCorrectIdx,         // 바뀐 정답 번호 저장
        isCorrect: isCorrect
      });
    }

    await UserAnswer.destroy({ where: { sessionId }, transaction: tx });
    await UserAnswer.bulkCreate(answerRecords, { transaction: tx });
    
    await tx.commit();
    return res.status(200).json({ ok: true, message: "답안이 임시 저장되었습니다." });
  } catch (error) {
    if (tx) await tx.rollback();
    return res.status(500).json({ ok: false, message: "답안 저장 중 오류 발생" });
  }
});

/**
 * 시험 최종 제출 및 결과(채점) 반환
 */
router.post("/exams/:sessionId/submit", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const sessionId = req.params.sessionId;
    const session = await ExamSession.findByPk(Number(sessionId));
    if (!session) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "세션을 찾을 수 없습니다." });
    }

    // 세션에 등록된 답안 불러오기 (문제 정보 포함)
    const userAnswers = await UserAnswer.findAll({
      where: { sessionId },
      include: [{ model: Question, as: 'questionInfo' }] // 사전에 Association 설정 필수
    });

    // 점수 계산 (예: 60문제 기준, 100점 만점 환산 등 기획에 맞게 수정)
    const correctCount = userAnswers.filter(ans => ans.getDataValue('isCorrect')).length;
    const totalQuestions = userAnswers.length;
    
    // 100점 만점 환산 (문제가 0개일 경우 방어 로직)
    const totalScore = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    await session.update({
      isCompleted: true,
      completedAt: new Date(),
      totalScore: totalScore
    }, { transaction: tx });

    await tx.commit();

    return res.status(200).json({ 
      ok: true, 
      message: "시험이 완료되었습니다.",
      result: {
        totalScore,
        correctCount,
        totalQuestions,
        answers: userAnswers // 프론트엔드에서 오답 노트 출력 시 사용
      }
    });
  } catch (error) {
    if (tx) await tx.rollback();
    console.error("채점 에러:", error);
    return res.status(500).json({ ok: false, message: "최종 제출 및 채점 중 오류 발생" });
  }
});

/**
 * 전체 시험 응시 이력 조회
 */
router.get("/exams/history", async (req: Request, res: Response) => {
  try {
    const sessions = await ExamSession.findAll({
      order: [["createdAt", "DESC"]], // 최신순 정렬
    });
    return res.status(200).json({ ok: true, data: sessions });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "이력 조회 실패" });
  }
});

/**
 * 특정 시험의 상세 결과 및 오답 노트 조회
 */
router.get("/exams/:sessionId/result", async (req: Request, res: Response) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const session = await ExamSession.findByPk(sessionId);
    if (!session) return res.status(404).json({ ok: false, message: "세션을 찾을 수 없습니다." });

    const userAnswers = await UserAnswer.findAll({
      where: { sessionId },
      include: [{ model: Question, as: 'questionInfo' }] // 사전에 Association 설정 필수
    });

    const correctCount = userAnswers.filter(ans => ans.getDataValue('isCorrect')).length;

    return res.status(200).json({ 
      ok: true, 
      result: {
        totalScore: session.getDataValue('totalScore'),
        correctCount,
        totalQuestions: userAnswers.length,
        answers: userAnswers
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "상세 결과 조회 실패" });
  }
});

/**
 * 응시 이력 삭제 API (관련 답안 데이터도 함께 삭제)
 */
router.delete("/exams/history/:sessionId", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const sessionId = Number(req.params.sessionId);
    
    const session = await ExamSession.findByPk(sessionId);
    if (!session) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "해당 응시 이력을 찾을 수 없습니다." });
    }

    // 1. 연관된 사용자 제출 답안 먼저 삭제 (외래키 제약조건 고려)
    await UserAnswer.destroy({ where: { sessionId }, transaction: tx });

    // 2. 응시 세션 삭제
    await session.destroy({ transaction: tx });

    await tx.commit();
    return res.status(200).json({ ok: true, message: "응시 이력이 삭제되었습니다." });
  } catch (error) {
    if (tx) await tx.rollback();
    console.error("응시 이력 삭제 에러:", error);
    return res.status(500).json({ ok: false, message: "삭제 중 서버 오류가 발생했습니다." });
  }
});

router.get("/exams/:sessionId/incorrect", async (req: Request, res: Response) => {
  try {
    const sessionId = Number(req.params.sessionId);

    // 1. 해당 세션에서 틀린 답안(isCorrect: false) 목록 조회
    const userAnswers = await UserAnswer.findAll({
      where: { sessionId, isCorrect: false },
      include: [{ model: Question, as: 'questionInfo' }]
    });

    if (userAnswers.length === 0) {
      return res.status(404).json({ ok: false, message: "틀린 문제가 없습니다. 100점입니다!" });
    }

    // 2. 틀린 문제들의 원본 데이터를 추출하여 보기를 다시 무작위로 섞음
    const questions = userAnswers.map(ans => {
      const qData = ans.getDataValue('questionInfo').get({ plain: true });
      
      const originalOptions = qData.options;
      const originalAnswerIdx = qData.answer;
      const correctText = originalOptions[originalAnswerIdx];

      const shuffledOptions = [...originalOptions];
      for (let i = shuffledOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
      }

      const newAnswerIdx = shuffledOptions.indexOf(correctText);

      return {
        ...qData,
        options: shuffledOptions,
        answer: newAnswerIdx 
      };
    });

    return res.status(200).json({ ok: true, count: questions.length, data: questions });
  } catch (error) {
    console.error("오답 문제 조회 에러:", error);
    return res.status(500).json({ ok: false, message: "오답 문제를 불러오는 중 오류 발생" });
  }
});
export default router;