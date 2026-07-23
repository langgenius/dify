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
  const health = await waitForHealth(`http://127.0.0.1:${port}/health`);

  console.log(
    JSON.stringify({
      compute: health.components.compute,
      difyDependencyConnected: health.components.objectStorage,
      healthOk: health.ok,
      imageTag,
      ok: true,
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
