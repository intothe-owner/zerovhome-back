import { Router, Request, Response } from "express";
import multer from "multer";
import crypto from "crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SeniorCenterCleanUp } from "../models";
import { createSeniorCenterReportPdfBuffer } from "../services/createSeniorCenterReportPdf";
import { encodeRFC5987ValueChars } from "../utils/fileName";
import sharp from "sharp";
const archiver = require("archiver");
const router = Router();
// S3 설정
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Multer 설정 (메모리 스토리지 사용)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 10MB 제한
});

/**
 * 경로당 상세 보고서 사진 업로드 API
 * PUT /api/senior-centers/:centerId/reports/:category/photos
 */
router.put(
  "/:centerId/reports/:category/photos",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const { centerId, category } = req.params;
      const { fieldName } = req.body; 
      const file = req.file;

      // 💡 1. centerId를 숫자로 명시적 변환 및 유효성 검사 추가
      const centerIdNum = Number(centerId);
      if (!Number.isInteger(centerIdNum) || centerIdNum <= 0) {
        return res.status(400).json({ ok: false, message: "유효하지 않은 경로당 ID입니다." });
      }

      if (!file || !fieldName) return res.status(400).json({ ok: false, message: "파일 또는 필드명이 없습니다." });

      // 2. Sharp 이미지 리사이징
      const processedBuffer = await sharp(file.buffer)
        .rotate().resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();

      // 3. S3 업로드 (문자열 centerId 대신 숫자 centerIdNum 사용)
      const s3Key = `senior-reports/${centerIdNum}/${category}/${crypto.randomUUID()}.jpg`;
      await s3.send(new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME!,
        Key: s3Key, Body: processedBuffer, ContentType: "image/jpeg",
      }));
      const imageUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

      // 4. 본체 테이블 JSON 컬럼 업데이트 (숫자 centerIdNum 전달)
      const center = await SeniorCenterCleanUp.findByPk(centerIdNum);
      if (!center) return res.status(404).json({ ok: false, message: "경로당을 찾을 수 없습니다." });

      const targetColumn = category === "AIR_CONDITIONER" ? "acReportImages" : "purifierReportImages";
      const currentImages = center.getDataValue(targetColumn) || {};
      
      currentImages[fieldName] = imageUrl;
      
      center.setDataValue(targetColumn, currentImages);
      // JSON 객체 내부 변경을 Sequelize에 알림
      center.changed(targetColumn, true); 
      await center.save();

      return res.status(200).json({
        ok: true, message: "사진이 업로드되었습니다.", data: { fieldName, imageUrl }
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ ok: false, message: "서버 오류" });
    }
  }
);

/**
 * 완료된 경로당 보고서 일괄 압축(ZIP) 다운로드 API
 * GET /api/senior-centers/bulk-download/pdf
 */
router.get("/bulk-download/pdf", async (req: Request, res: Response) => {
  try {
    const organization = (req.query.org as string) || "기관명 없음";
    
    // 💡 1. 삭제된 SeniorCenterReport 대신 본체 테이블인 SeniorCenterCleanUp을 직접 조회합니다.
    const completedCenters = await SeniorCenterCleanUp.findAll({
      where: { isComplete: true }
    });

    if (!completedCenters || completedCenters.length === 0) {
      return res.status(404).json({ ok: false, message: "완료된 경로당 작업이 없습니다." });
    }

    // 2. ZIP 응답 헤더 설정 (스트리밍 방식)
    const todayStr = new Date().toISOString().split('T')[0];
    const zipFileName = `완료보고서_일괄다운로드_${todayStr}.zip`;
    
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeRFC5987ValueChars(zipFileName)}"`
    );

    // 3. archiver 초기화 및 클라이언트 응답 스트림 연결
    const archive = archiver("zip", {
      zlib: { level: 9 }, // 압축률 최대 (0~9)
    });

    archive.on("error", (err: any) => {
      console.error("ZIP Archive 에러:", err);
      throw err;
    });

    archive.pipe(res);

    // 공통 날짜 포맷
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const formattedWorkDate = `${year}.${month}.${day}`;

    // 💡 4. 각 경로당마다 에어컨/공기청정기 사진 데이터(JSON)가 있는지 확인하고 각각 PDF 생성
    for (const center of completedCenters) {
      const finalWorkerName = center.workName || "작업자";
      const centerAny = center as any; // 타입스크립트 엄격성 우회

      // 에어컨 데이터와 공기청정기 데이터를 변수에 담습니다.
      const acPhotos = centerAny.acReportImages;
      const purifierPhotos = centerAny.purifierReportImages;

      // PDF 생성을 위한 내부 헬퍼 함수
      const appendPdfToZip = async (category: string, label: string, photosJson: any) => {
        // 사진 데이터(JSON)가 아예 비어있으면 PDF를 생성하지 않고 건너뜁니다.
        if (!photosJson || Object.keys(photosJson).length === 0) return;

        const pdfParams = {
          title: `${label} 세척 작업보고서`,
          centerName: center.name,
          agencyName: organization,
          companyName: "(주)제로브이",
          companyAddress: "부산광역시 해운대구 신반송로 151, 106호",
          companyPhone: "051-545-1150",
          ceoName: "김남관",
          workDate: formattedWorkDate,
          workerName: finalWorkerName,
          address: center.roadAddress,
          photos: photosJson // JSON 객체를 그대로 주입
        };

        const pdfBuffer = await createSeniorCenterReportPdfBuffer(pdfParams);
        const fileName = `${organization}_${center.name}_${category}_작업보고서.pdf`;
        
        archive.append(pdfBuffer, { name: fileName });
      };

      // 에어컨 보고서가 있으면 압축 파일에 추가
      await appendPdfToZip("AIR_CONDITIONER", "에어컨", acPhotos);
      
      // 공기청정기 보고서가 있으면 압축 파일에 추가
      await appendPdfToZip("AIR_PURIFIER", "공기청정기", purifierPhotos);
    }

    // 5. 압축 및 전송 완료
    await archive.finalize();

  } catch (error) {
    console.error("일괄 PDF 압축 에러:", error);
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, message: "일괄 다운로드 중 서버 오류가 발생했습니다." });
    } else {
      res.end(); // 스트림 강제 종료
    }
  }
});
/**
 * 경로당 PDF 보고서 생성 및 다운로드
 * GET /api/senior-centers/:id/reports/:category/pdf
 */
router.get("/:id/reports/:category/pdf", async (req: Request, res: Response) => {
  try {
    const { id, category } = req.params;
    const idNum = Number(id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      return res.status(400).json({ ok: false, message: "유효하지 않은 경로당 ID입니다." });
    }
    const center = await SeniorCenterCleanUp.findByPk(idNum);
    if (!center) return res.status(404).json({ ok: false, message: "데이터를 찾을 수 없습니다." });

    let finalWorkerName = center.workName || "작업자";
    if (req.query.workName) {
        finalWorkerName = req.query.workName as string;
        await center.update({ workName: finalWorkerName });
    }

    const today = new Date();
    const formattedWorkDate = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

    // JSON 컬럼에서 사진 데이터 추출
    const targetColumn = category === "AIR_CONDITIONER" ? "acReportImages" : "purifierReportImages";
    const reportImages = center.getDataValue(targetColumn) || {};

    const pdfParams = {
      title: `${category === "AIR_CONDITIONER" ? "에어컨" : "공기청정기"} 세척 작업보고서`,
      centerName: center.name,
      agencyName: (req.query.org as string) || "기관명 없음",
      companyName: "(주)제로브이",
      companyAddress: "부산광역시 해운대구 신반송로 151, 106호",
      companyPhone: "051-545-1150",
      ceoName: "김남관",
      workDate: formattedWorkDate,
      workerName: finalWorkerName,
      address: center.roadAddress,
      photos: reportImages // JSON 그대로 전달
    };

    const pdfBuffer = await createSeniorCenterReportPdfBuffer(pdfParams);
    const fileName = `${pdfParams.agencyName}_${center.name}_${category}_작업보고서.pdf`;
   
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeRFC5987ValueChars(fileName)}"`);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, message: "서버 오류" });
  }
});
export default router;