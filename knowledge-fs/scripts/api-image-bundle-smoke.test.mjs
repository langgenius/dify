import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const smokeScript = readFileSync(new URL("./api-image-bundle-smoke.mjs", import.meta.url), "utf8");
const apiDockerfile = readFileSync(new URL("../apps/api/Dockerfile", import.meta.url), "utf8");
const apiPackageJson = JSON.parse(
  readFileSync(new URL("../apps/api/package.json", import.meta.url), "utf8"),
);

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
  assert.match(smokeScript, /verifyPdfRasterizerRuntime/);
  assert.match(smokeScript, /pdftoppm/);
  assert.match(smokeScript, /KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY/);
  assert.match(smokeScript, /maxConcurrency !== 2/);
  assert.match(smokeScript, /verifySharpRuntime/);
  assert.match(smokeScript, /await import\("sharp"\)/);
  assert.match(smokeScript, /sharp\.versions\.vips/);
  assert.match(smokeScript, /imageProcessing/);
  assert.match(smokeScript, /productionConfigValidated: false/);
  assert.match(smokeScript, /scope: "isolated-bundle"/);
  assert.match(smokeScript, /dockerStop/);
});

test("production API image carries and executes the target platform sharp runtime", () => {
  assert.equal(apiPackageJson.dependencies.sharp, "^0.35.3");
  assert.match(apiPackageJson.scripts["build:prod"], /--external:sharp/);
  assert.match(apiDockerfile, /realpath apps\/api\/node_modules\/sharp/);
  assert.match(apiDockerfile, /cp -LR/);
  assert.match(apiDockerfile, /COPY --from=builder \/runtime\/node_modules \.\/node_modules/);
  assert.match(apiDockerfile, /await import\('sharp'\)/);
  assert.match(apiDockerfile, /sharp native runtime smoke failed/);
});

test("production API image carries and executes the Poppler PDF rasterizer", () => {
  assert.match(apiDockerfile, /apt-get install --yes --no-install-recommends poppler-utils/);
  assert.match(apiDockerfile, /KNOWLEDGE_PDF_RASTERIZER=poppler/);
  assert.match(apiDockerfile, /KNOWLEDGE_PDF_RASTERIZER_DPI=144/);
  assert.match(apiDockerfile, /KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI=48/);
  assert.match(apiDockerfile, /KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS=30000/);
  assert.match(apiDockerfile, /KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS=500/);
  assert.match(apiDockerfile, /KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY=2/);
  assert.match(apiDockerfile, /command -v pdftoppm/);
  assert.match(apiDockerfile, /pdftoppm -v/);
});
