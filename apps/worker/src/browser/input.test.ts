import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { makeBrowserInputTools } from "./input.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  await context?.close();
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("https://preview.test/**", (route) => route.fulfill({
    contentType: "text/html",
    body: '<div contenteditable="true" id="editor"></div><textarea id="plain"></textarea>',
  }));
  await page.goto("https://preview.test/");
});

async function execute(name: string, args: unknown) {
  const tool = makeBrowserInputTools(page).find((tool) => tool.def.name === name);
  assert.ok(tool);
  return tool.execute(args);
}

test("pastes exact multiline plain text through a trusted paste event", async () => {
  await page.evaluate(() => {
    document.addEventListener("paste", (event) => {
      document.body.dataset.paste = JSON.stringify({
        trusted: event.isTrusted,
        text: event.clipboardData?.getData("text/plain"),
        types: event.clipboardData?.types,
      });
    });
  });
  await page.locator("#editor").click();
  const text = 'first\nsecond\nthird\n\nfifth <script>alert("no")</script>';
  const result = await execute("browser_paste", { text });
  assert.equal(await page.locator("#editor").innerText(), text);
  assert.deepEqual(JSON.parse(await page.locator("body").getAttribute("data-paste") ?? "null"), {
    trusted: true, text, types: ["text/plain"],
  });
  assert.equal(await page.locator("#editor script").count(), 0);
  assert.equal(JSON.stringify(result).includes(text), false);
  await page.locator("#plain").click();
  await page.keyboard.press("ControlOrMeta+V");
  assert.equal(await page.locator("#plain").inputValue(), "");
});

test("one and two Enter presses insert exactly the requested line breaks", async () => {
  await page.locator("#plain").fill("first");
  await execute("browser_press_key", { key: "Enter" });
  await execute("browser_paste", { text: "second" });
  await execute("browser_press_key", { key: "Enter" });
  await execute("browser_press_key", { key: "Enter" });
  await execute("browser_paste", { text: "fourth" });
  assert.equal(await page.locator("#plain").inputValue(), "first\nsecond\n\nfourth");
});

test("page scripts cannot replace clipboard writing and no read permission is granted", async () => {
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new Error("page override"); };
  });
  await page.locator("#plain").click();
  await execute("browser_paste", { text: "supplied text" });
  assert.equal(await page.locator("#plain").inputValue(), "supplied text");
  assert.notEqual(await page.evaluate("navigator.permissions.query({ name: 'clipboard-read' }).then(permission => permission.state)"), "granted");
});

test("paste respects the editor preventing default insertion", async () => {
  await page.evaluate(() => {
    document.addEventListener("paste", (event) => event.preventDefault(), { once: true });
  });
  await page.locator("#editor").click();
  await execute("browser_paste", { text: "cancelled" });
  assert.equal(await page.locator("#editor").innerText(), "");
  await page.locator("#plain").click();
  await page.keyboard.press("ControlOrMeta+V");
  assert.equal(await page.locator("#plain").inputValue(), "");
});

test("closes the session if clipboard cleanup is blocked", async () => {
  await page.route("https://preview.test/blocked", (route) => route.fulfill({
    contentType: "text/html",
    headers: { "Permissions-Policy": "clipboard-write=()" },
    body: '<textarea id="plain"></textarea>',
  }));
  await page.goto("https://preview.test/blocked");
  await page.locator("#plain").click();
  await assert.rejects(execute("browser_paste", { text: "must not remain" }), /Clipboard cleanup failed; browser session closed/);
  assert.equal(context.pages().length, 0);
});

test("rejects clipboard shortcuts, code, and malformed arguments", async () => {
  for (const key of ["ControlOrMeta+V", "ControlOrMeta+C", "ControlOrMeta+X", "F12", "javascript:alert(1)", "Enter+Enter"]) {
    await assert.rejects(execute("browser_press_key", { key }), /Invalid option/);
  }
  await assert.rejects(execute("browser_paste", { text: 42 }), /Invalid input/);
  assert.equal(await page.locator("#plain").inputValue(), "");
});
