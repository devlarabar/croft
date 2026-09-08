import { requestUrl } from "./request-url";

export function isCsrfRequest(request: Request): boolean {
  return !/^(GET|HEAD)$/.test(request.method)
    && /^\b(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)\b/i.test(request.headers.get("content-type") ?? "text/plain")
    && request.headers.get("sec-fetch-site") !== "same-origin"
    && request.headers.get("origin") !== requestUrl(request).origin;
}
