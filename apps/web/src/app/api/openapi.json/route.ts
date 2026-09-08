import { openApiSpec } from "../../../openapi";

export function GET() {
  return Response.json(openApiSpec);
}
