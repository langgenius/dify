#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const docker = "docker";
const imageTag = process.env.API_IMAGE_TAG?.trim() || "knowledge-fs-api:local";
const maxJsonBytes = Number.parseInt(
  process.env.API_IMAGE_BUNDLE_SMOKE_MAX_JSON_BYTES ??
    process.env.API_IMAGE_HTTP_SMOKE_MAX_JSON_BYTES ??
    "65536",
  10,
);
const timeoutMs = Number.parseInt(
  process.env.API_IMAGE_BUNDLE_SMOKE_TIMEOUT_MS ??
    process.env.API_IMAGE_HTTP_SMOKE_TIMEOUT_MS ??
    "15000",
  10,
);

if (!Number.isInteger(maxJsonBytes) || maxJsonBytes < 1) {
  throw new Error("API_IMAGE_BUNDLE_SMOKE_MAX_JSON_BYTES must be a positive integer");
}

if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
  throw new Error("API_IMAGE_BUNDLE_SMOKE_TIMEOUT_MS must be at least 1000");
}

let containerId = "";

try {
  containerId = (
    await execFileAsync(docker, [
      "run",
      "--rm",
      "--detach",
      "--env",
      "NODE_ENV=test",
      "--env",
      "PORT=8787",
      "--publish",
      "127.0.0.1::8787",
      imageTag,
    ])
  ).stdout.trim();

  if (!containerId) {
    throw new Error("Docker did not return a container id");
  }

  const port = await dockerPort(containerId);
  const imageProcessing = await verifySharpRuntime(containerId);
  const pdfRasterizer = await verifyPdfRasterizerRuntime(containerId);
  const health = await waitForHealth(`http://127.0.0.1:${port}/health`);

  console.log(
    JSON.stringify({
      compute: health.components.compute,
      difyDependencyConnected: health.components.objectStorage,
      healthOk: health.ok,
      imageTag,
      imageProcessing,
      ok: true,
      pdfRasterizer,
      port,
      productionConfigValidated: false,
      runtime: health.runtime,
      scope: "isolated-bundle",
    }),
  );
} finally {
  if (containerId) {
    await dockerStop(containerId);
  }
}

async function verifyPdfRasterizerRuntime(containerId) {
  const [
    { stderr, stdout },
    concurrencyResult,
    materializationConcurrencyResult,
    fallbackConcurrencyResult,
    fallbackReservedBytesResult,
  ] = await Promise.all([
    execFileAsync(docker, ["exec", containerId, "pdftoppm", "-v"]),
    execFileAsync(docker, [
      "exec",
      containerId,
      "printenv",
      "KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY",
    ]),
    execFileAsync(docker, [
      "exec",
      containerId,
      "printenv",
      "KNOWLEDGE_DOCUMENT_MATERIALIZATION_MAX_CONCURRENCY",
    ]),
    execFileAsync(docker, [
      "exec",
      containerId,
      "printenv",
      "KNOWLEDGE_DIRECT_UPLOAD_SMALL_FALLBACK_MAX_CONCURRENCY",
    ]),
    execFileAsync(docker, [
      "exec",
      containerId,
      "printenv",
      "KNOWLEDGE_DIRECT_UPLOAD_SMALL_FALLBACK_MAX_RESERVED_BYTES",
    ]),
  ]);
  const version = `${stdout}${stderr}`.trim();
  const maxConcurrency = Number(concurrencyResult.stdout.trim());
  const materializationMaxConcurrency = Number(materializationConcurrencyResult.stdout.trim());
  const fallbackMaxConcurrency = Number(fallbackConcurrencyResult.stdout.trim());
  const fallbackMaxReservedBytes = Number(fallbackReservedBytesResult.stdout.trim());

  if (!/^pdftoppm version\b/m.test(version)) {
    throw new Error(`Unexpected Poppler PDF rasterizer version output: ${version}`);
  }
  if (maxConcurrency !== 2) {
    throw new Error(`Unexpected Poppler PDF rasterizer max concurrency: ${maxConcurrency}`);
  }
  if (materializationMaxConcurrency !== 2) {
    throw new Error(
      `Unexpected document materialization max concurrency: ${materializationMaxConcurrency}`,
    );
  }
  if (fallbackMaxConcurrency !== 2) {
    throw new Error(`Unexpected small fallback max concurrency: ${fallbackMaxConcurrency}`);
  }
  if (fallbackMaxReservedBytes !== 31457280) {
    throw new Error(`Unexpected small fallback byte budget: ${fallbackMaxReservedBytes}`);
  }

  return {
    command: "pdftoppm",
    fallbackMaxConcurrency,
    fallbackMaxReservedBytes,
    materializationMaxConcurrency,
    maxConcurrency,
    version: version.split("\n")[0],
  };
}

async function verifySharpRuntime(containerId) {
  const program = `
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).png().toBuffer({ resolveWithObject: true });
    if (data.byteLength < 1 || info.format !== "png" || info.width !== 2 || info.height !== 1) {
      throw new Error("sharp native runtime did not produce the expected PNG");
    }
    console.log(JSON.stringify({
      format: info.format,
      height: info.height,
      sharp: sharp.versions.sharp,
      vips: sharp.versions.vips,
      width: info.width,
    }));
  `;
  const { stdout } = await execFileAsync(docker, [
    "exec",
    containerId,
    "node",
    "--input-type=module",
    "--eval",
    program,
  ]);
  const result = JSON.parse(stdout.trim());

  if (
    result.format !== "png" ||
    result.width !== 2 ||
    result.height !== 1 ||
    typeof result.sharp !== "string" ||
    typeof result.vips !== "string"
  ) {
    throw new Error(`Unexpected sharp runtime smoke result: ${stdout.trim()}`);
  }

  return result;
}

async function dockerPort(containerId) {
  const { stdout } = await execFileAsync(docker, ["port", containerId, "8787/tcp"]);
  const firstMapping = stdout.trim().split("\n")[0] ?? "";
  const match = /:(\d+)$/.exec(firstMapping);

  if (!match) {
    throw new Error(`Could not resolve mapped API port from docker output: ${stdout.trim()}`);
  }

  return Number(match[1]);
}

async function dockerStop(containerId) {
  try {
    await execFileAsync(docker, ["rm", "--force", containerId], { timeout: 10_000 });
  } catch (error) {
    console.error(`Failed to stop isolated API bundle smoke container ${containerId}: ${error}`);
  }
}

async function waitForHealth(url) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      const payload = await readBoundedJson(response);

      if (
        response.status === 200 &&
        payload.ok === false &&
        payload.components?.compute === true &&
        payload.components?.objectStorage === false
      ) {
        return payload;
      }

      lastError = new Error(`GET /health returned ${response.status}: ${JSON.stringify(payload)}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw lastError instanceof Error ? lastError : new Error("Isolated API bundle smoke timed out");
}

async function readBoundedJson(response) {
  if (!response.body) {
    return {};
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxJsonBytes) {
        throw new Error(`API image health response exceeded ${maxJsonBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder().decode(bytes));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
