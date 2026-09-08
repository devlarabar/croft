import { route } from "../../../../http";
import { handleWebhook } from "../../../../webhook";

export const POST = route(handleWebhook);
