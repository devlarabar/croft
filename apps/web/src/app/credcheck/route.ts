import { decrypt, getConfig } from "@croft/core";
import { getCredentials } from "../../data/credentials";
import { route } from "../../http";

export const GET = route(async () => {
  const rows = await getCredentials();
  const cfg = await getConfig();
  return Response.json(rows.map((row) => {
    let decrypts = true;
    try {
      decrypt(row.encrypted);
    } catch {
      decrypts = false;
    }
    return {
      id: row.id,
      providerId: row.providerId,
      kind: row.kind,
      createdAt: row.createdAt,
      decrypts,
      active: cfg.activeModel?.credentialId === row.id,
    };
  }));
});
