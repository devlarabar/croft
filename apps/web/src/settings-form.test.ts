import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { decrypt, encrypt, type Config } from "@croft/core";
import { settingsPatch } from "./settings-form";

process.env.TOKEN_ENC_KEY = randomBytes(32).toString("hex");

const cfg: Config = {
  id: 1, activeModel: null, webhooksEnabled: false, toolCallCap: 50,
  repos: ["owner/repo"], autoReviewRepos: [], allowedUsers: [], findingsPing: null,
  findingsPingAuthor: false, agentFixContext: false, repoContext: {},
  previewLogins: { "owner/repo": [
    { username: "first", encryptedPassword: encrypt("first-password") },
    { username: "second", encryptedPassword: encrypt("second-password") },
  ] },
};

test("blank passwords preserve the matching login even when an earlier row is deleted", () => {
  const form = new FormData();
  form.set("repos", "owner/repo");
  form.set("login_user_owner/repo_0", "");
  form.set("login_user_owner/repo_1", "second");
  form.set("login_pass_owner/repo_1", "");
  form.set("login_user_owner/repo_2", "new without a password");
  const patch = settingsPatch(form, cfg);
  const logins = patch.previewLogins["owner/repo"];
  assert.ok(logins);
  assert.equal(logins.length, 1);
  assert.equal(logins[0]?.username, "second");
  assert.equal(logins[0]?.encryptedPassword, cfg.previewLogins["owner/repo"]?.[1]?.encryptedPassword);
});

test("new passwords are encrypted and submitted text retains its normalization", () => {
  const form = new FormData();
  form.set("repos", " owner/repo \n\n other/repo ");
  form.set("allowedUsers", " first \n\n second ");
  form.set("autoreview_owner/repo", "on");
  form.set("autoreview_removed/repo", "on");
  form.set("context_owner/repo", " context ");
  form.set("findingsPing", " @maintainer ");
  form.set("webhooksEnabled", "on");
  form.set("findingsPingAuthor", "on");
  form.set("agentFixContext", "on");
  form.set("toolCallCap", "75");
  form.set("login_user_owner/repo_0", " first ");
  form.set("login_pass_owner/repo_0", " new password ");
  form.set("login_label_owner/repo_0", " label ");
  form.set("login_url_owner/repo_0", " https://preview.test/login ");
  const patch = settingsPatch(form, cfg);
  assert.deepEqual(patch.repos, ["owner/repo", "other/repo"]);
  assert.deepEqual(patch.allowedUsers, ["first", "second"]);
  assert.deepEqual(patch.autoReviewRepos, ["owner/repo"]);
  assert.deepEqual(patch.repoContext, { "owner/repo": "context" });
  assert.equal(patch.findingsPing, "maintainer");
  assert.equal(patch.toolCallCap, 75);
  assert.equal(patch.webhooksEnabled, true);
  assert.equal(patch.findingsPingAuthor, true);
  assert.equal(patch.agentFixContext, true);
  const login = patch.previewLogins["owner/repo"]?.[0];
  assert.ok(login);
  assert.equal(login.username, "first");
  assert.equal(login.label, "label");
  assert.equal(login.loginUrl, "https://preview.test/login");
  assert.equal(decrypt(login.encryptedPassword), " new password ");
});

test("invalid run limits retain the configured cap and removing repos drops their credentials", () => {
  for (const cap of ["", "0", "-1", "1.5", "NaN"]) {
    const form = new FormData();
    form.set("toolCallCap", cap);
    const patch = settingsPatch(form, cfg);
    assert.equal(patch.toolCallCap, 50);
    assert.deepEqual(patch.previewLogins, {});
    assert.deepEqual(patch.repoContext, {});
    assert.equal(patch.findingsPing, null);
  }
});
