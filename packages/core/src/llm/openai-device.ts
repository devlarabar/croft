import { z } from "zod";
import { exchangeCode, OAuthRequestError, type TokenResponse } from "./oauth.js";
import type { OAuthDeviceConfig } from "./types.js";

// https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs
export const openaiOAuth: OAuthDeviceConfig = {
  flow: "device",
  tokenUrl: "https://auth.openai.com/oauth/token",
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  redirectUri: "https://auth.openai.com/deviceauth/callback",
  tokenEncoding: "form",
};

export const openaiDeviceCodeSchema = z.object({
  deviceAuthId: z.string().min(1),
  userCode: z.string().min(1),
  intervalSeconds: z.number().int().positive(),
});
export type OpenAiDeviceCode = z.infer<typeof openaiDeviceCodeSchema>;

const deviceResponseSchema = z.object({
  device_auth_id: z.string(),
  user_code: z.string().optional(),
  usercode: z.string().optional(),
  interval: z.union([z.string().trim().regex(/^\d+$/).transform(Number), z.number()])
    .pipe(z.number().int().nonnegative()).default(5),
}).transform((data) => ({
  deviceAuthId: data.device_auth_id,
  userCode: data.user_code ?? data.usercode,
  intervalSeconds: Math.max(1, data.interval),
})).pipe(openaiDeviceCodeSchema);
const approvalSchema = z.object({ authorization_code: z.string().min(1), code_verifier: z.string().min(1) });

export async function requestOpenAiDeviceCode(signal?: AbortSignal): Promise<OpenAiDeviceCode> {
  const response = await fetch("https://auth.openai.com/api/accounts/deviceauth/usercode", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: openaiOAuth.clientId }),
    signal,
  });
  if (!response.ok) throw new OAuthRequestError("device-code", response.status);
  return deviceResponseSchema.parse(await response.json());
}

export async function checkOpenAiDeviceCode(device: OpenAiDeviceCode, signal?: AbortSignal): Promise<TokenResponse | null> {
  const response = await fetch("https://auth.openai.com/api/accounts/deviceauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_auth_id: device.deviceAuthId, user_code: device.userCode }),
    signal,
  });
  // Codex treats 403/404 as pending approval until the 15-minute deadline.
  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new OAuthRequestError("device-approval", response.status);
  const code = approvalSchema.parse(await response.json());
  return exchangeCode(openaiOAuth, code.authorization_code, code.code_verifier, signal);
}
