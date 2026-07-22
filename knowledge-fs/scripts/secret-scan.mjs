import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
]);

export const KNOWLEDGE_FS_INTEGRATION_EXACT_PATHS = Object.freeze([
  ".github/dependabot.yml",
  ".github/workflows/knowledge-fs-ci.yml",
  "api/.env.example",
  "api/app_factory.py",
  "api/commands/__init__.py",
  "api/controllers/console/__init__.py",
  "api/controllers/console/workspace/rbac.py",
  "api/controllers/service_api/__init__.py",
  "api/core/agent/base_agent_runner.py",
  "api/core/app/apps/agent_app/runtime_request_builder.py",
  "api/core/rbac/entities.py",
  "api/core/tools/__base/tool_runtime.py",
  "api/core/tools/builtin_tool/_position.yaml",
  "api/core/workflow/node_runtime.py",
  "api/core/workflow/nodes/agent_v2/runtime_request_builder.py",
  "api/extensions/ext_celery.py",
  "api/extensions/ext_commands.py",
  "api/models/__init__.py",
  "api/pyproject.toml",
  "api/services/account_service.py",
  "api/services/agent_tool_inner_service.py",
  "api/services/enterprise/rbac_service.py",
  "api/services/entities/agent_tool_inner.py",
  "api/tests/unit_tests/controllers/console/workspace/test_rbac.py",
  "api/tests/unit_tests/core/agent/test_base_agent_runner.py",
  "api/tests/unit_tests/core/app/apps/agent_app/test_runtime_request_builder.py",
  "api/tests/unit_tests/core/workflow/nodes/agent_v2/test_runtime_request_builder.py",
  "api/tests/unit_tests/core/workflow/nodes/tool/test_tool_node_runtime.py",
  "api/tests/unit_tests/core/workflow/test_node_runtime.py",
  "api/tests/unit_tests/services/enterprise/test_rbac_service.py",
  "api/tests/unit_tests/services/test_account_service.py",
  "api/tests/unit_tests/services/test_agent_tool_inner_service.py",
  "api/uv.lock",
  "dify-agent/src/dify_agent/layers/dify_core_tools/client.py",
  "dify-agent/tests/local/dify_agent/layers/dify_core_tools/test_client.py",
  "docker/.env.example",
  "docker/README.md",
  "docker/dify-env-sync.py",
  "docker/dify-env-sync.sh",
  "docker/docker-compose-template.yaml",
  "docker/docker-compose.yaml",
  "docker/envs/core-services/api.env.example",
  "docker/envs/core-services/knowledge-fs.env.example",
  "docker/generate_docker_compose",
]);

export const KNOWLEDGE_FS_INTEGRATION_PREFIXES = Object.freeze([
  Object.freeze({ path: "knowledge-fs/", workflowPattern: "knowledge-fs/**" }),
  Object.freeze({
    path: "packages/contracts/generated/api/console/",
    workflowPattern: "packages/contracts/generated/api/console/**",
  }),
  Object.freeze({
    path: "packages/contracts/generated/api/service/",
    workflowPattern: "packages/contracts/generated/api/service/**",
  }),
]);

const INTEGRATION_EXACT_PATHS = new Set(KNOWLEDGE_FS_INTEGRATION_EXACT_PATHS);

const SECRET_RULES = [
  {
    name: "private-key",
    pattern: /-----BEGIN (?:(?:DSA|EC|ENCRYPTED|OPENSSH|RSA) )?PRIVATE KEY-----/g,
  },
  { name: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  {
    name: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g,
  },
  { name: "google-api-key", pattern: /\bAIza[A-Za-z0-9_-]{32,}\b/g },
  { name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: "stripe-live-secret", pattern: /\b(?:rk|sk)_live_[A-Za-z0-9]{24,}\b/g },
  { name: "openai-api-key", pattern: /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}\b/g },
  { name: "anthropic-api-key", pattern: /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{20,}\b/g },
  {
    name: "dify-knowledge-fs-credential",
    pattern: /(?<![A-Za-z0-9_-])kfs_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
  },
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
];

const ALLOWLIST_ENTRY_KEYS = ["fingerprint", "line", "path", "reason", "rule"];

function fingerprint(rule, value) {
  return createHash("sha256").update(rule).update("\0").update(value).digest("hex");
}

function locationAt(content, offset) {
  const prefix = content.slice(0, offset);
  const lastNewline = prefix.lastIndexOf("\n");
  return {
    column: offset - lastNewline,
    line: prefix.split("\n").length,
  };
}

export function scanText({ content, path }) {
  const findings = [];
  for (const rule of SECRET_RULES) {
    for (const match of content.matchAll(rule.pattern)) {
      const location = locationAt(content, match.index);
      findings.push({
        column: location.column,
        fingerprint: fingerprint(rule.name, match[0]),
        line: location.line,
        path,
        rule: rule.name,
      });
    }
  }
  return findings.sort(compareFindings);
}

function compareFindings(left, right) {
  return (
    left.path.localeCompare(right.path) ||
    left.line - right.line ||
    left.column - right.column ||
    left.rule.localeCompare(right.rule)
  );
}

function isProbablyBinary(content) {
  return content.includes("\0");
}

async function filesUnder(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name))
        files.push(...(await filesUnder(root, absolutePath)));
      continue;
    }
    if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

export async function scanDirectory(root) {
  const findings = [];
  for (const absolutePath of await filesUnder(root)) {
    const content = await readFile(absolutePath, "utf8");
    if (isProbablyBinary(content)) continue;
    const path = relative(root, absolutePath).split(sep).join("/");
    findings.push(...scanText({ content, path }));
  }
  return findings.sort(compareFindings);
}

export function isKnowledgeFsIntegrationPath(path) {
  const normalizedPath = path.split(sep).join("/");
  if (
    KNOWLEDGE_FS_INTEGRATION_PREFIXES.some(({ path: prefix }) => normalizedPath.startsWith(prefix))
  )
    return true;
  if (INTEGRATION_EXACT_PATHS.has(normalizedPath)) return true;

  const parts = normalizedPath.split("/");
  const basename = parts.at(-1) ?? "";
  if (
    normalizedPath.startsWith("api/") &&
    (parts.includes("knowledge_fs") ||
      basename.includes("knowledge_fs") ||
      basename.includes("knowledge-fs"))
  ) {
    return true;
  }
  return normalizedPath.startsWith("docs/design/") && basename.includes("knowledge-fs");
}

export async function scanIntegrationSurface(root) {
  const findings = [];
  for (const absolutePath of await filesUnder(root)) {
    const path = relative(root, absolutePath).split(sep).join("/");
    if (!isKnowledgeFsIntegrationPath(path)) continue;
    const content = await readFile(absolutePath, "utf8");
    if (isProbablyBinary(content)) continue;
    findings.push(...scanText({ content, path }));
  }
  return findings.sort(compareFindings);
}

export function parseAllowlist(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== 1 ||
    !Array.isArray(value.entries)
  ) {
    throw new Error("Secret scan allowlist must contain version 1 and an entries array.");
  }

  const entries = value.entries.map((entry) => {
    const keys =
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? Object.keys(entry).sort()
        : [];
    const hasExactKeys =
      keys.length === ALLOWLIST_ENTRY_KEYS.length &&
      keys.every((key, index) => key === ALLOWLIST_ENTRY_KEYS[index]);
    if (
      !hasExactKeys ||
      typeof entry.path !== "string" ||
      entry.path.length === 0 ||
      entry.path.startsWith("/") ||
      entry.path.split("/").includes("..") ||
      /[*?[\]]/.test(entry.path) ||
      !Number.isInteger(entry.line) ||
      entry.line < 1 ||
      typeof entry.rule !== "string" ||
      !SECRET_RULES.some((rule) => rule.name === entry.rule) ||
      typeof entry.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.fingerprint) ||
      typeof entry.reason !== "string" ||
      entry.reason.trim().length < 10
    ) {
      throw new Error(
        "Each secret scan allowlist entry requires an exact path, line, rule, fingerprint, and reason.",
      );
    }
    return entry;
  });

  const keys = entries.map(allowlistKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Secret scan allowlist contains a duplicate entry.");
  }
  return { entries, version: 1 };
}

function allowlistKey(value) {
  return `${value.path}\0${value.line}\0${value.rule}\0${value.fingerprint}`;
}

export function evaluateFindings(findings, allowlist) {
  const findingKeys = new Set(findings.map(allowlistKey));
  const allowedKeys = new Set(allowlist.entries.map(allowlistKey));
  return {
    staleAllowlistEntries: allowlist.entries.filter(
      (entry) => !findingKeys.has(allowlistKey(entry)),
    ),
    unallowedFindings: findings.filter((finding) => !allowedKeys.has(allowlistKey(finding))),
  };
}

async function run() {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const repositoryRoot = resolve(packageRoot, "..");
  const allowlistPath = resolve(packageRoot, "secret-scan-allowlist.json");
  const allowlist = parseAllowlist(JSON.parse(await readFile(allowlistPath, "utf8")));
  const findings = await scanIntegrationSurface(repositoryRoot);
  const result = evaluateFindings(findings, allowlist);

  for (const finding of result.unallowedFindings) {
    console.error(
      `${finding.path}:${finding.line}:${finding.column} ${finding.rule} (${finding.fingerprint})`,
    );
  }
  for (const entry of result.staleAllowlistEntries) {
    console.error(
      `${entry.path}:${entry.line} stale ${entry.rule} allowlist entry (${entry.fingerprint})`,
    );
  }
  if (result.unallowedFindings.length > 0 || result.staleAllowlistEntries.length > 0) {
    throw new Error(
      `Secret scan failed with ${result.unallowedFindings.length} finding(s) and ${result.staleAllowlistEntries.length} stale allowlist entry(s).`,
    );
  }
  console.log(`Secret scan passed (${findings.length} explicitly allowlisted finding(s)).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
