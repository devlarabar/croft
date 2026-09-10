import { checkOpenAiDeviceCode, requestOpenAiDeviceCode } from "@croft/core";
import { OpenAiDevicePage } from "../../../components/openai-device-page";
import { html } from "../../../html";
import { redirect, route } from "../../../http";
import { oauthFailure, storeOAuthCredential } from "../../../oauth-credential";
import { getOpenAiDeviceState, setOpenAiDeviceState } from "../../../session";

export const GET = route(async (request) => {
  try {
    const device = await requestOpenAiDeviceCode(AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]));
    const response = await html(<OpenAiDevicePage userCode={device.userCode} />);
    setOpenAiDeviceState(response, {
      ...device, expiresAt: Date.now() + 15 * 60_000, nextCheckAt: Date.now() + device.intervalSeconds * 1000,
    });
    return response;
  } catch (error) {
    const response = oauthFailure("openai", error);
    setOpenAiDeviceState(response, null);
    return response;
  }
});

export const POST = route(async (request) => {
  const state = getOpenAiDeviceState(request);
  if (!state) return redirect("/models?notice=OpenAI+login+expired.+Please+connect+again.");
  if (Date.now() < state.nextCheckAt) return html(<OpenAiDevicePage userCode={state.userCode} pending />);
  let response: Response;
  try {
    const tokens = await checkOpenAiDeviceCode(state, AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]));
    if (!tokens) {
      response = await html(<OpenAiDevicePage userCode={state.userCode} pending />);
      setOpenAiDeviceState(response, { ...state, nextCheckAt: Date.now() + state.intervalSeconds * 1000 });
      return response;
    }
    await storeOAuthCredential("openai", tokens);
    response = redirect("/models?notice=OAuth+connected.+Select+the+new+credential+and+set+it+active.");
  } catch (error) {
    response = oauthFailure("openai", error);
  }
  setOpenAiDeviceState(response, null);
  return response;
});
