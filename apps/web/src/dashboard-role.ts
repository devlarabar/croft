import { headers } from "next/headers";
import { z } from "zod";

export async function dashboardRole() {
  return z.enum(["user", "member", "admin"]).parse((await headers()).get("x-croft-role"));
}
