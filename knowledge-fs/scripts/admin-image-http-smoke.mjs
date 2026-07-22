#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const docker = "docker";
const imageTag = process.env.ADMIN_IMAGE_TAG?.trim() || "knowledge-fs-admin:local";
const maxHtmlBytes = Number.parseInt(
  process.env.ADMIN_IMAGE_HTTP_SMOKE_MAX_HTML_BYTES ?? "262144",
  10,
);
const timeoutMs = Number.parseInt(process.env.ADMIN_IMAGE_HTTP_SMOKE_TIMEOUT_MS ?? "15000", 10);

if (!Number.isInteger(maxHtmlBytes) || maxHtmlBytes < 1) {
  throw new Error("ADMIN_IMAGE_HTTP_SMOKE_MAX_HTML_BYTES must be a positive integer");
}

if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
  throw new Error("ADMIN_IMAGE_HTTP_SMOKE_TIMEOUT_MS must be at least 1000");
}

let containerId = "";

try {
  containerId = (
    await execFileAsync(docker, [
      "run",
      "--rm",
      "--detach",
      "--env",
      "NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8788",
      "--publish",
      "127.0.0.1::3000",
      imageTag,
    ])
  ).stdout.trim();

  if (!containerId) {
    throw new Error("Docker did not return a container id");
  }

  const port = await dockerPort(containerId);
  await waitForAdmin(`http://127.0.0.1:${port}/`);

  console.log(JSON.stringify({ imageTag, ok: true, port, runtime: "next-standalone" }));
} finally {
  if (containerId) {
    await dockerStop(containerId);
  }
}

async function dockerPort(containerId) {
  const { stdout } = await execFileAsync(docker, ["port", containerId, "3000/tcp"]);
  const firstMapping = stdout.trim().split("\n")[0] ?? "";
  const match = /:(\d+)$/.exec(firstMapping);

  if (!match) {
    throw new Error(`Could not resolve mapped Admin port from docker output: ${stdout.trim()}`);
  }

  return Number(match[1]);
}

async function dockerStop(containerId) {
  try {
    await execFileAsync(docker, ["rm", "--force", containerId], { timeout: 10_000 });
  } catch (error) {
    console.error(`Failed to stop Admin image smoke container ${containerId}: ${error}`);
  }
}

async function waitForAdmin(url) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      const html = await readBoundedText(response);

      if (response.status === 200 && html.includes("KnowledgeFS Admin")) {
        return;
      }

      lastError = new Error(`GET / returned ${response.status}: ${html.slice(0, 512)}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw lastError instanceof Error ? lastError : new Error("Admin image HTTP smoke timed out");
}

async function readBoundedText(response) {
  if (!response.body) {
    return "";
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
      if (totalBytes > maxHtmlBytes) {
        throw new Error(`Admin image HTML response exceeded ${maxHtmlBytes} bytes`);
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

  return new TextDecoder().decode(bytes);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
