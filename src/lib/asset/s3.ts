import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} from "@aws-sdk/client-s3";
import { env } from "../env";

let cached: S3Client | null = null;

export function s3(): S3Client {
  if (cached) return cached;
  const e = env();
  cached = new S3Client({
    region: e.S3_REGION,
    endpoint: e.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: e.S3_ACCESS_KEY,
      secretAccessKey: e.S3_SECRET_KEY,
    },
  });
  return cached;
}

export function publicUrl(key: string): string {
  return `${env().S3_PUBLIC_URL.replace(/\/$/, "")}/${env().S3_BUCKET}/${key}`;
}

export async function ensureBucket() {
  const e = env();
  const client = s3();
  try {
    await client.send(new HeadBucketCommand({ Bucket: e.S3_BUCKET }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: e.S3_BUCKET }));
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: e.S3_BUCKET,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { AWS: ["*"] },
              Action: ["s3:GetObject"],
              Resource: [`arn:aws:s3:::${e.S3_BUCKET}/*`],
            },
          ],
        }),
      }),
    );
  }
}

export async function uploadAsset(
  key: string,
  body: Buffer,
  contentType = "image/png",
) {
  const e = env();
  await s3().send(
    new PutObjectCommand({
      Bucket: e.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return publicUrl(key);
}
