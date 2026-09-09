import { z } from "zod";

export const RUNS_PER_PAGE = 12;
export const runFilterSchema = z.enum(["all", "passed", "failed", "error", "partial"]);
export const runPageSchema = z.coerce.number().int().positive();
