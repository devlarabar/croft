// One-off diagnostic: list recent GitHub App webhook deliveries.
// Usage: GITHUB_APP_ID=<id> node scripts/app-deliveries.mjs [comment_id]
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const appId = process.env.GITHUB_APP_ID ?? "4457316"; // agent-croft
const pem = readFileSync(new URL("../croft-pkcs8.pem", import.meta.url), "utf8");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: appId })}`;
const sig = createSign("RSA-SHA256").update(unsigned).sign(pem).toString("base64url");
const jwt = `${unsigned}.${sig}`;

// Delivery ids exceed Number.MAX_SAFE_INTEGER; keep raw text around.
const gh = (path) =>
  fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json" },
  }).then(async (r) => {
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    return r.text();
  });

const guid = process.argv[2];
const raw = await gh("/app/hook/deliveries?per_page=50");
if (!guid) {
  for (const d of JSON.parse(raw)) {
    console.log(d.delivered_at, d.event, d.action ?? "", `status=${d.status}(${d.status_code})`, d.guid);
  }
} else {
  const id = raw.match(new RegExp(`"id":(\\d+),"guid":"${guid}"`))?.[1];
  if (!id) throw new Error("guid not in last 50 deliveries");
  const full = JSON.parse(await gh(`/app/hook/deliveries/${id}`));
  console.log("response body:", JSON.stringify(full.response?.payload));
}
