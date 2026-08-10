import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the webcam tester shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Dual Webcam Portrait Tester<\/title>/i);
  assert.match(html, /Camera A \/ Camera B/);
  assert.match(html, /Dual webcam portrait tester/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps requested camera controls in the app source", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");

  assert.match(page, /enumerateDevices/);
  assert.match(page, /Exchange A and B/);
  assert.match(page, /Capture photo/);
  assert.match(page, /Record 5s video/);
  assert.match(page, /MediaRecorder/);
  assert.match(page, /Mirror/);
  assert.match(page, /No mirror/);
  assert.match(css, /aspect-ratio:\s*6\s*\/\s*19/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
