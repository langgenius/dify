import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const smokeScript = readFileSync(new URL("./admin-image-http-smoke.mjs", import.meta.url), "utf8");

test("Admin image HTTP smoke starts the standalone container and checks the homepage", () => {
  assert.match(smokeScript, /knowledge-fs-admin:local/);
  assert.match(smokeScript, /docker/);
  assert.match(smokeScript, /run/);
  assert.match(smokeScript, /NEXT_PUBLIC_API_BASE_URL=http:\/\/127\.0\.0\.1:8788/);
  assert.match(smokeScript, /127\.0\.0\.1::3000/);
  assert.match(smokeScript, /dockerPort/);
  assert.match(smokeScript, /KnowledgeFS Admin/);
  assert.match(smokeScript, /dockerStop/);
});

test("Admin image HTTP smoke bounds HTML response reads", () => {
  assert.match(smokeScript, /ADMIN_IMAGE_HTTP_SMOKE_MAX_HTML_BYTES/);
  assert.match(smokeScript, /readBoundedText/);
  assert.match(smokeScript, /totalBytes > maxHtmlBytes/);
});
