import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const smokeScript = readFileSync(new URL("./api-image-bundle-smoke.mjs", import.meta.url), "utf8");

test("isolated API bundle smoke starts the container and checks compute health", () => {
  assert.match(smokeScript, /knowledge-fs-api:local/);
  assert.match(smokeScript, /docker/);
  assert.match(smokeScript, /run/);
  assert.match(smokeScript, /NODE_ENV=test/);
  assert.match(smokeScript, /PORT=8787/);
  assert.match(smokeScript, /127\.0\.0\.1::8787/);
  assert.match(smokeScript, /dockerPort/);
  assert.match(smokeScript, /\/health/);
  assert.match(smokeScript, /payload\.ok === false/);
  assert.match(smokeScript, /components\?\.compute === true/);
  assert.match(smokeScript, /components\?\.objectStorage === false/);
  assert.match(smokeScript, /difyDependencyConnected/);
  assert.match(smokeScript, /productionConfigValidated: false/);
  assert.match(smokeScript, /scope: "isolated-bundle"/);
  assert.match(smokeScript, /dockerStop/);
});
