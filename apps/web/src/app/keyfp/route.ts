import { route } from "../../http";
import { keyFingerprint } from "../../key-fingerprint";

export const GET = route(() => new Response(keyFingerprint()));
