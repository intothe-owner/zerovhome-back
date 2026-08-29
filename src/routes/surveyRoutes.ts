import { Router, Request, Response } from "express";
import { sequelize } from "../config/database";
import { WorkSite } from "../models/WorkSite";
import { WorkItem } from "../models/WorkItem";
import { SiteSurvey } from "../models/SiteSurvey";
import { SiteSurveyResponse } from "../models/SiteSurveyResponse";

const router = Router();

/**
 * 1. 현장별 설문조사 문항(폼) 등록 및 수정 API (관리자용)
 * POST /work-sites/:id/survey
 */
router.post("/work-sites/:id/survey", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const workSiteId = Number(req.params.id);
    const { title, description, questions } = req.body; 

    if (!title || !title.trim()) {
      await tx.rollback();
      return res.status(400).json({ ok: false, message: "설문 제목은 필수입니다." });
    }

    if (!questions || !Array.isArray(questions)) {
      await tx.rollback();
      return res.status(400).json({ ok: false, message: "문항(questions) 배열이 필요합니다." });
    }

    const site = await WorkSite.findByPk(workSiteId, { transaction: tx });
    if (!site) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "현장을 찾을 수 없습니다." });
    }

    if (!site.hasSurvey) {
      await site.update({ hasSurvey: true }, { transaction: tx });
    }

    let siteSurvey = await SiteSurvey.findOne({ where: { workSiteId }, transaction: tx });

    if (siteSurvey) {
      siteSurvey = await siteSurvey.update({ title, description, questions }, { transaction: tx });
    } else {
      siteSurvey = await SiteSurvey.create({
        workSiteId,
        title,
        description,
        questions
      }, { transaction: tx });
    }

    await tx.commit();
    return res.status(200).json({ ok: true, data: siteSurvey, message: "설문 폼이 저장되었습니다." });

  } catch (error) {
    if (tx) await tx.rollback();
    console.error("설문 폼 저장 에러:", error);
    return res.status(500).json({ ok: false, message: "서버 오류가 발생했습니다." });
  }
});

/**
 * 2. 현장별 설문조사 문항(폼) 조회 API
 * GET /work-sites/:id/survey
 */
router.get("/work-sites/:id/survey", async (req: Request, res: Response) => {
  try {
    const workSiteId = Number(req.params.id);
    const siteSurvey = await SiteSurvey.findOne({ where: { workSiteId } });

    if (!siteSurvey) {
      return res.status(404).json({ ok: false, message: "등록된 설문 폼이 없습니다." });
    }

    return res.status(200).json({ ok: true, data: siteSurvey });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "설문 폼 조회 중 오류가 발생했습니다." });
  }
});

/**
 * 3. 개별 작업 설문 응답 제출 API (작업자/고객용)
 * POST /work-items/:id/survey-response
 */
router.post("/work-items/:id/survey-response", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const workItemId = Number(req.params.id);
    const { answers } = req.body;

    if (!answers) {
      await tx.rollback();
      return res.status(400).json({ ok: false, message: "응답(answers) 데이터가 필요합니다." });
    }

    const item = await WorkItem.findByPk(workItemId, { transaction: tx });
    if (!item) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "작업을 찾을 수 없습니다." });
    }

    const siteSurvey = await SiteSurvey.findOne({ 
      where: { workSiteId: item.workSiteId }, 
      transaction: tx 
    });

    if (!siteSurvey) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "이 현장에는 활성화된 설문 폼이 없습니다." });
    }

    let surveyResponse = await SiteSurveyResponse.findOne({ 
      where: { workItemId }, 
      transaction: tx 
    });

    if (surveyResponse) {
      surveyResponse = await surveyResponse.update({ answers }, { transaction: tx });
    } else {
      surveyResponse = await SiteSurveyResponse.create({
        workItemId,
        siteSurveyId: siteSurvey.id,
        answers
      }, { transaction: tx });
    }

    await tx.commit();
    return res.status(200).json({ 
      ok: true, 
      data: surveyResponse, 
      message: "설문 응답이 성공적으로 저장되었습니다." 
    });

  } catch (error) {
    if (tx) await tx.rollback();
    console.error("설문 응답 저장 에러:", error);
    return res.status(500).json({ ok: false, message: "설문 응답 저장 중 서버 오류가 발생했습니다." });
  }
});

/**
 * 4. 개별 작업 설문 응답 조회 API
 * GET /work-items/:id/survey-response
 */
router.get("/work-items/:id/survey-response", async (req: Request, res: Response) => {
  try {
    const workItemId = Number(req.params.id);
    const surveyResponse = await SiteSurveyResponse.findOne({ where: { workItemId } });

    if (!surveyResponse) {
      return res.status(404).json({ ok: false, message: "등록된 설문 응답이 없습니다." });
    }

    return res.status(200).json({ ok: true, data: surveyResponse });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "설문 응답 조회 중 오류가 발생했습니다." });
  }
});

export default router;