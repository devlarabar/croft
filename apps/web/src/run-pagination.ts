import { z } from "zod";

export const RUNS_PER_PAGE = 25;
export const runPageSchema = z.coerce.number().int().positive();
