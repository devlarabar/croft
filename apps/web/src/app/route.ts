import { redirect } from "../http";

export function GET() {
  return redirect("/runs");
}
