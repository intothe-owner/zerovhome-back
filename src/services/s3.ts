import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const REGION = process.env.AWS_REGION!;
const BUCKET = process.env.AWS_S3_BUCKET!;

// ✅ S3 Client (권장: IAM Role/환경변수 자격증명)
const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// ✅ 퍼블릭 URL 구성(버킷을 공개로 운영하거나 CloudFront 쓰는 경우에 맞춰 변경)
export function publicUrlForKey(key: string) {
  // 기본 S3 퍼블릭 URL 형식 (리전/버킷 정책에 따라 다를 수 있음)
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

export async function putObjectToS3(params: {
  key: string;
  body: Buffer;
  contentType: string;
}) {
  const { key, body, contentType } = params;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      // ACL: "public-read", // ✅ 퍼블릭 운영이면 사용 (버킷 설정에 따라 막힐 수 있음)
      // CacheControl: "public, max-age=31536000",
    })
  ); // PutObjectCommand :contentReference[oaicite:4]{index=4}

  return {
    key,
    url: publicUrlForKey(key),
  };
}
