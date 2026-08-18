import { Router, Request, Response } from "express";
import { Op, WhereOptions } from "sequelize";
import { CleanUpHousehold } from "../models/CleanUpHousehold";
import { ErrorReport } from "../models";
import multer from "multer";
import fs from "fs";
import path from "path";
import { sequelize } from "../db/sequelize";
import multerS3 from "multer-s3";
import { DeleteObjectCommand, S3Client,PutObjectCommand } from "@aws-sdk/client-s3";
// ✅ sharp 추가
import sharp from "sharp";
const s3 = new S3Client({
  region: process.env.AWS_REGION, // 예: 'ap-northeast-2'
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
const router = Router();

const uploadDir = path.resolve(process.cwd(), "uploads", "households");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const householdId = req.params.id ?? "unknown";
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const safeField = (file.fieldname || "image").replace(/[^a-zA-Z0-9_-]/g, "");
    cb(null, `household_${householdId}_${safeField}_${Date.now()}${ext}`);
  },
});

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (!file.mimetype.startsWith("image/")) {
    return cb(new Error("이미지 파일만 업로드할 수 있습니다."));
  }
  cb(null, true);
};

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_S3_BUCKET!, // 버킷 이름
    contentType: multerS3.AUTO_CONTENT_TYPE, // 자동으로 mimetype 설정 (브라우저에서 열기 가능하게)
    //acl: 'public-read', // 권한 설정 (필요에 따라 변경)
    key: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, ext);
      const safeBaseName = baseName.replace(/[^a-zA-Z0-9가-힣_-]/g, "_");

      // 
      cb(null, `uploads/zerovapp/${Date.now()}_${Math.round(Math.random() * 1e9)}_${safeBaseName}${ext}`);
    },
  }),
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});
// ✅ 1. Sharp 가공을 위해 파일을 메모리에 임시 저장하는 Multer 설정
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 50MB
});
const memoryPhotoUpload = memoryUpload.fields([
  { name: "addressImage", maxCount: 1 },
  { name: "beforeImage", maxCount: 1 },
  { name: "duringImage", maxCount: 1 },
  { name: "afterImage", maxCount: 1 },
]);
// ✅ 2. 이미지 가공 및 S3 수동 업로드 헬퍼 함수
async function processAndUploadImage(file: Express.Multer.File): Promise<string | null> {
  if (!file) return null;

  // sharp로 EXIF 회전 복구(.rotate) 및 1024px 리사이징 후 JPEG 압축
  const processedBuffer = await sharp(file.buffer)
    .rotate() // 눕는 현상 방지
    .resize({ width: 1024, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  const ext = ".jpg"; // 강제 변환했으므로 .jpg 통일
  const baseName = path.basename(file.originalname, path.extname(file.originalname));
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9가-힣_-]/g, "_");
  const s3Key = `uploads/zerovapp/${Date.now()}_${Math.round(Math.random() * 1e9)}_${safeBaseName}${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: s3Key,
    Body: processedBuffer,
    ContentType: "image/jpeg",
  }));

  return `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
}
function toPublicPath(file?: any) {
  if (!file) return null;
  // S3 업로드 시에는 file.location에 전체 URL이 담겨 있습니다.
  return file.location || null;
}

async function deleteOldFile(fileUrl?: string | null) {
  if (!fileUrl || !fileUrl.startsWith("http")) return;

  try {
    // URL에서 S3 Key(경로)만 추출합니다.
    // 예: https://bucket.s3.region.amazonaws.com/uploads/zerovapp/file.jpg 
    // -> Key: uploads/zerovapp/file.jpg
    const url = new URL(fileUrl);
    const bucketKey = url.pathname.replace(/^\/+/, "");

    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: bucketKey,
    });

    await s3.send(command);
    console.log("S3 기존 파일 삭제 완료:", bucketKey);
  } catch (err) {
    console.error("S3 기존 파일 삭제 실패:", err);
  }
}

/**
 * GET /households/list
 */
router.get("/list", async (req: Request, res: Response) => {
  try {
    const {
      page = 1,
      pageSize = 20,
      q = "",
      sort = "localNo",
      order = "asc",
      isArchived,
      isComplete // 프론트에서 보낼 작업완료 여부
    } = req.query;

    const where: any = {};

    // 탭 구분을 위한 로직
    if (isComplete === "true") {
      where.isComplete = true;
    } else if (isArchived === "true") {
      where.isArchived = true;
      where.isComplete = false; // 동선에는 아직 완료 안 된 것만 표시
    } else {
      where.isArchived = false;
      where.isComplete = false; // 일반 목록
    }

    if (q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { phone: { [Op.like]: `%${q}%` } },
        { proxyPhone: { [Op.like]: `%${q}%` } },
        { roadAddress: { [Op.like]: `%${q}%` } }
      ];
    }

    const { rows, count } = await CleanUpHousehold.findAndCountAll({
      where,
      limit: Number(pageSize),
      offset: (Number(page) - 1) * Number(pageSize),
      // 보관함이나 완료 목록은 최신순 혹은 지정 순서(routeOrder)로 정렬
      order: isComplete === "true"
        ? [['updatedAt', 'DESC']]
        : (isArchived === "true" ? [['routeOrder', 'ASC']] : [[String(sort), String(order).toUpperCase()]]),
    });

    return res.json({
      items: rows,
      pagination: {
        page: Number(page),
        total: count,
        totalPages: Math.ceil(count / Number(pageSize)),
      },
    });
  } catch (err: any) {
    await ErrorReport.create({
        section:'클린업 목록',
        error:err?.message??String(err)
      })
    res.status(500).json({ message: "서버 오류" });
  }
});

/**
 * PUT /households/:id/photos
 * form-data:
 * - addressImage: 1장
 * - beforeImage: 1장
 * - duringImage: 1장
 * - afterImage: 1장
 */
router.put("/:id/photos", (req: Request, res: Response) => {
  console.log("사진 업로드 요청 도착:", req.method, req.originalUrl);

  // ✅ 기존 photoUpload 대신 메모리 버퍼를 사용하는 memoryPhotoUpload로 변경
  memoryPhotoUpload(req, res, async (uploadErr: any) => {
    try {
      if (uploadErr) {
        console.error("multer 업로드 에러:", uploadErr);
        return res.status(400).json({
          message: "photo upload failed",
          error: uploadErr?.message ?? String(uploadErr),
        });
      }

      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "invalid id" });
      }

      const item = await CleanUpHousehold.findByPk(id);

      if (!item) {
        return res.status(404).json({ message: "household not found" });
      }

      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

      const addressImageFile = files?.addressImage?.[0];
      const beforeImageFile = files?.beforeImage?.[0];
      const duringImageFile = files?.duringImage?.[0];
      const afterImageFile = files?.afterImage?.[0];

      if (!addressImageFile && !beforeImageFile && !duringImageFile && !afterImageFile) {
        return res.status(400).json({
          message: "at least one image is required",
        });
      }

      // ✅ 파일 가공 및 S3 업로드 대기
      const newAddressUrl = addressImageFile ? await processAndUploadImage(addressImageFile) : null;
      const newBeforeUrl = beforeImageFile ? await processAndUploadImage(beforeImageFile) : null;
      const newDuringUrl = duringImageFile ? await processAndUploadImage(duringImageFile) : null;
      const newAfterUrl = afterImageFile ? await processAndUploadImage(afterImageFile) : null;

      // 기존 파일 삭제 (비동기 처리)
      if (newAddressUrl && item.addressImage) await deleteOldFile(item.addressImage);
      if (newBeforeUrl && item.beforeImage) await deleteOldFile(item.beforeImage);
      if (newDuringUrl && item.duringImage) await deleteOldFile(item.duringImage);
      if (newAfterUrl && item.afterImage) await deleteOldFile(item.afterImage);

      // DB 경로 업데이트 (헬퍼 함수에서 반환된 URL을 그대로 저장)
      if (newAddressUrl) item.addressImage = newAddressUrl;
      if (newBeforeUrl) item.beforeImage = newBeforeUrl;
      if (newDuringUrl) item.duringImage = newDuringUrl;
      if (newAfterUrl) item.afterImage = newAfterUrl;

      await item.save();

      return res.json({
        message: "photos uploaded successfully",
        item: {
          id: item.id,
          photos: {
            addressImage: item.addressImage,
            beforeImage: item.beforeImage,
            duringImage: item.duringImage,
            afterImage: item.afterImage,
          },
        },
      });
    } catch (err: any) {
      console.error("사진 업로드 내부 에러:", err);
      await ErrorReport.create({
        section:'사진업로드',
        error:err?.message??String(err)
      })
      return res.status(500).json({
        message: "failed to upload photos",
        error: err?.message ?? String(err),
      });
    }
  });
});

/**
 * GET /households/:id
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        message: "invalid id",
      });
    }

    const item = await CleanUpHousehold.findByPk(id, {
      attributes: [
        "id",
        "programYear",
        "listType",
        "localNo",
        "categoryCode",
        "dong",
        "benefitType",
        "name",
        "rrn",
        "phone",
        "proxyPhone",
        "roadAddress",
        "detailAddress",
        "rank",
        "totalScore",
        "scoreHouseholdSize",
        "scoreAge",
        "scoreDisability",
        "scoreResidencePeriod",
        "scoreBenefitType",
        "scoreOther",
        "otherReason",
        "remark",
        "addressImage",
        "beforeImage",
        "duringImage",
        "afterImage",
        "createdAt",
        "updatedAt",
      ],
    });

    if (!item) {
      return res.status(404).json({
        message: "household not found",
      });
    }

    return res.json({
      item: {
        id: item.id,
        programYear: item.programYear,
        listType: item.listType,
        localNo: item.localNo,
        categoryCode: item.categoryCode,
        dong: item.dong,
        benefitType: item.benefitType,
        name: item.name,
        rrn: item.rrn,
        phone: item.phone,
        proxyPhone: item.proxyPhone,
        roadAddress: item.roadAddress,
        detailAddress: item.detailAddress,
        rank: item.rank,
        totalScore: item.totalScore,
        scoreHouseholdSize: item.scoreHouseholdSize,
        scoreAge: item.scoreAge,
        scoreDisability: item.scoreDisability,
        scoreResidencePeriod: item.scoreResidencePeriod,
        scoreBenefitType: item.scoreBenefitType,
        scoreOther: item.scoreOther,
        otherReason: item.otherReason,
        remark: item.remark,
        photos: {
          addressImage: item.addressImage,
          beforeImage: item.beforeImage,
          duringImage: item.duringImage,
          afterImage: item.afterImage,
        },
      },
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({
      message: "failed to fetch household detail",
      error: err?.message ?? String(err),
    });
  }
});
/**
 * 가구 보관함 이동 API
 * PATCH /api/households/:id/archive
 */
router.patch("/:id/archive", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction(); // 순서 일관성을 위해 트랜잭션 시작
  try {
    const { id } = req.params;
    const { is_complete } = req.body;

    const household = await CleanUpHousehold.findByPk(id);

    if (!household) {
      await tx.rollback();
      return res.status(404).json({ ok: false, message: "해당 데이터를 찾을 수 없습니다." });
    }

    const wasArchived = household.isArchived;
    const currentOrder = household.routeOrder;
    console.log(is_complete);

    if (wasArchived) {
      // [CASE 1: 보관함 해제]
      // 1. 현재 항목 해제 (isArchived: false, routeOrder: 0)
      await household.update({ isArchived: false, routeOrder: 0, isComplete: is_complete ?? false }, { transaction: tx });

      // 2. 빠진 번호 뒤의 항목들 순서를 하나씩 당김 (routeOrder = routeOrder - 1)
      await CleanUpHousehold.update(
        { routeOrder: sequelize.literal("route_order - 1") },
        {
          where: {
            isArchived: true,
            routeOrder: { [Op.gt]: currentOrder }, // 나보다 순서가 컸던 항목들만
          },
          transaction: tx,
        }
      );
    } else {
      // [CASE 2: 보관함 추가]
      // 1. 현재 보관함의 마지막 순번 확인
      const maxOrder = await CleanUpHousehold.max("routeOrder", {
        where: { isArchived: true },
      });

      // 2. 마지막 순번 + 1로 추가
      await household.update(
        { isArchived: true, routeOrder: (Number(maxOrder) || 0) + 1 },
        { transaction: tx }
      );
    }

    await tx.commit();

    return res.status(200).json({
      ok: true,
      message: wasArchived ? "보관함에서 제거되었습니다." : "보관함으로 이동되었습니다.",
      id: household.id,
    });
  } catch (error) {
    if (tx) await tx.rollback();
    console.error(error);
    return res.status(500).json({ ok: false, message: "서버 오류가 발생했습니다." });
  }
});

/**
 * 보관함 내 동선 순서 변경 API (Swap 방식)
 * PATCH /api/households/reorder
 */
router.patch("/reorder", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const { dragId, dropId } = req.body; // 바꿀 두 아이템의 ID
    console.log(req.body);

    const itemA = await CleanUpHousehold.findByPk(dragId);
    const itemB = await CleanUpHousehold.findByPk(dropId);

    if (!itemA || !itemB) {
      return res.status(404).json({ ok: false, message: "항목을 찾을 수 없습니다." });
    }

    // 두 항목의 routeOrder 값을 서로 바꿈
    const tempOrder = itemA.routeOrder;
    itemA.routeOrder = itemB.routeOrder;
    itemB.routeOrder = tempOrder;

    await itemA.save({ transaction: tx });
    await itemB.save({ transaction: tx });

    await tx.commit();
    return res.json({ ok: true, message: "순서가 변경되었습니다." });
  } catch (err) {
    await tx.rollback();
    console.error(err);
    return res.status(500).json({ ok: false, message: "순서 변경 중 오류 발생" });
  }
});
//개별적 등록
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      name,
      rrn,
      phone,
      proxyPhone,
      roadAddress,
      detailAddress,
      latitude,
      longitude,
      // 추가적으로 필요한 필드가 있다면 여기에 구조분해 할당
    } = req.body;

    // 1. 필수값 체크 (예시)
    if (!name || !roadAddress) {
      return res.status(400).json({ ok: false, message: "이름과 주소는 필수 항목입니다." });
    }

    // 2. 관리 번호(localNo) 자동 생성 로직 (필요시)
    // 현재 연도의 가장 높은 localNo를 찾아 +1 하거나, 클라이언트에서 보낸 값을 사용
    const maxLocalNo = await CleanUpHousehold.max("localNo", {
      where: { programYear: new Date().getFullYear() }
    });
    const nextLocalNo = (Number(maxLocalNo) || 0) + 1;

    // 3. 데이터 생성
    const newHousehold = await CleanUpHousehold.create({
      programYear: new Date().getFullYear(), // 기본값: 현재 연도
      listType: "SELECTED", // 기본값: 선정
      localNo: nextLocalNo,
      categoryCode: 1, // 기본 카테고리 설정
      dong: roadAddress.split(" ")[1] || "", // 주소에서 '동' 추출 시도
      benefitType: "기타", // 기본 수급 유형
      name,
      rrn,
      phone,
      proxyPhone,
      roadAddress,
      detailAddress,
      latitude,
      longitude,
      rank: 0,
      totalScore: 0,
      isArchived: false,
      isComplete: false,
      isCancel: false,
      routeOrder: 0
    });

    return res.status(201).json({
      ok: true,
      message: "대상자가 성공적으로 등록되었습니다.",
      data: newHousehold
    });
  } catch (error) {
    console.error("등록 에러:", error);
    return res.status(500).json({ ok: false, message: "서버 오류가 발생했습니다." });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    await CleanUpHousehold.update({
      isCancel: true,
      isArchived: false,
      routeOrder: 0
    }, {
      where: {
        id
      }
    });
    return res.status(200).json({
      ok: true,
      message: "대상자가 성공적으로 삭제되었습니다.",
    });
  } catch (e) {

  }
})
export default router;