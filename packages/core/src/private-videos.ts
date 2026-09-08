import { PutObjectAclCommand } from "@aws-sdk/client-s3";
import { BUCKET, listArtifactKeys, s3 } from "./s3.js";

const keys = await listArtifactKeys("");
let count = 0;
for (const key of keys) {
  if (!key.endsWith(".webm")) continue;
  await s3.send(new PutObjectAclCommand({ Bucket: BUCKET, Key: key, ACL: "private" }));
  count++;
}
console.log(`Set ${count} videos to private. Ensure bucket policies do not grant public access to videos.`);
