import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { repoTools } from "./repo.js";

const exec = promisify(execFile);

test("read_file reads committed blobs without following symlinks or opening worker files", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "croft-repo-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const checkout = join(directory, "checkout");
  const outside = join(directory, "outside");
  await mkdir(checkout);
  await mkdir(outside);
  await writeFile(join(outside, "fixture.txt"), "synthetic-worker-secret");
  await writeFile(join(checkout, "normal.txt"), "first\nsecond\nthird");
  await symlink(join(outside, "fixture.txt"), join(checkout, "file-link"));
  await symlink(outside, join(checkout, "directory-link"));
  await exec("git", ["init", "--quiet", checkout]);
  await exec("git", ["add", "normal.txt", "file-link", "directory-link"], { cwd: checkout });
  const { stdout: tree } = await exec("git", ["write-tree"], { cwd: checkout });
  const { stdout: commit } = await exec("git", [
    "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test",
    "commit-tree", tree.trim(), "-m", "Fixture",
  ], { cwd: checkout });
  await exec("git", ["update-ref", "HEAD", commit.trim()], { cwd: checkout });
  await writeFile(join(checkout, "normal.txt"), "uncommitted contents");
  await writeFile(join(checkout, "untracked.txt"), "synthetic-worker-secret");

  const read = repoTools(checkout).find((tool) => tool.def.name === "read_file");
  assert.ok(read);
  assert.deepEqual(await read.execute({ path: "normal.txt", startLine: 2, endLine: 3 }), [
    { type: "text", text: "2\tsecond\n3\tthird" },
  ]);
  assert.deepEqual(await read.execute({ path: "./normal.txt", endLine: 1 }), [
    { type: "text", text: "1\tfirst" },
  ]);
  assert.deepEqual(await read.execute({ path: "file-link" }), [
    { type: "text", text: `1\t${join(outside, "fixture.txt")}` },
  ]);
  assert.deepEqual(await read.execute({ path: "directory-link" }), [
    { type: "text", text: `1\t${outside}` },
  ]);
  for (const path of ["directory-link/fixture.txt", "untracked.txt", ".git/config"]) {
    await assert.rejects(read.execute({ path }), /fatal:/);
  }
  for (const path of ["../outside/fixture.txt", join(outside, "fixture.txt")]) {
    assert.deepEqual(await read.execute({ path }), [
      { type: "text", text: `Refused: ${path} is outside the repository.` },
    ]);
  }
});
