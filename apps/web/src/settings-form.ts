import { encrypt, type Config, type PreviewLogin } from "@croft/core";

function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

export function settingsPatch(form: FormData, cfg: Config) {
  const repos = lines(form.get("repos"));
  const previewLogins: Record<string, PreviewLogin[]> = {};
  const repoContext: Record<string, string> = {};
  for (const repo of repos) {
    const context = String(form.get(`context_${repo}`) ?? "").trim();
    if (context) repoContext[repo] = context;
    const existing = cfg.previewLogins[repo] ?? [];
    const logins: PreviewLogin[] = [];
    for (let index = 0; form.get(`login_user_${repo}_${index}`) !== null; index++) {
      const username = String(form.get(`login_user_${repo}_${index}`)).trim();
      if (!username) continue;
      const password = String(form.get(`login_pass_${repo}_${index}`) ?? "");
      const label = String(form.get(`login_label_${repo}_${index}`) ?? "").trim() || undefined;
      const loginUrl = String(form.get(`login_url_${repo}_${index}`) ?? "").trim() || undefined;
      const encryptedPassword = password ? encrypt(password) : existing[index]?.encryptedPassword;
      if (encryptedPassword) logins.push({ label, username, loginUrl, encryptedPassword });
    }
    if (logins.length > 0) previewLogins[repo] = logins;
  }
  const toolCallCap = Number(form.get("toolCallCap"));
  return {
    webhooksEnabled: form.get("webhooksEnabled") === "on",
    toolCallCap: Number.isInteger(toolCallCap) && toolCallCap > 0 ? toolCallCap : cfg.toolCallCap,
    repos,
    autoReviewRepos: repos.filter((repo) => form.get(`autoreview_${repo}`) === "on"),
    allowedUsers: lines(form.get("allowedUsers")),
    previewLogins,
    repoContext,
    findingsPing: String(form.get("findingsPing") ?? "").trim().replace(/^@/, "") || null,
    findingsPingAuthor: form.get("findingsPingAuthor") === "on",
    agentFixContext: form.get("agentFixContext") === "on",
  };
}
