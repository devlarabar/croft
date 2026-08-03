import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { withRetry } from "./retry.js";

const REGION = process.env.S3_REGION ?? "fr-par";
// Overridden in local dev to point at MinIO (path-style URLs).
const CUSTOM_ENDPOINT = process.env.S3_ENDPOINT;

export const s3 = new S3Client({
  region: REGION,
  endpoint: CUSTOM_ENDPOINT ?? `https://s3.${REGION}.scw.cloud`,
  forcePathStyle: Boolean(CUSTOM_ENDPOINT),
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});

export const BUCKET = process.env.S3_BUCKET ?? "croft-artifacts";

// Objects are public-read and referenced by plain URLs — presigned URLs rot
// behind GitHub's Camo cache.
export function publicUrl(key: string): string {
  if (CUSTOM_ENDPOINT) return `${CUSTOM_ENDPOINT}/${BUCKET}/${key}`;
  return `https://${BUCKET}.s3.${REGION}.scw.cloud/${key}`;
}

export async function uploadArtifact(
  key: string,
  body: Buffer,
  contentType: "image/png" | "video/webm",
): Promise<string> {
  // Camo silently refuses to render images served as application/octet-stream.
  await withRetry(
    () =>
      s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
          ACL: "public-read",
        }),
      ),
    { attempts: 3 },
  );
  return publicUrl(key);
}

export async function getArtifactStream(key: string) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return res.Body ?? null;
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

export async function listArtifactKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    keys.push(...(res.Contents ?? []).map((object) => object.Key!));
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

export async function deleteArtifacts(keys: string[]): Promise<void> {
  for (let offset = 0; offset < keys.length; offset += 1000) {
    const batch = keys.slice(offset, offset + 1000);
    await withRetry(
      () =>
        s3.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: { Objects: batch.map((Key) => ({ Key })) },
          }),
        ),
      { attempts: 3 },
    );
  }
}
