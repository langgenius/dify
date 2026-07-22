import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  KNOWLEDGE_FS_INTEGRATION_EXACT_PATHS,
  KNOWLEDGE_FS_INTEGRATION_PREFIXES,
  evaluateFindings,
  isKnowledgeFsIntegrationPath,
  parseAllowlist,
  scanDirectory,
  scanIntegrationSurface,
  scanText,
} from "./secret-scan.mjs";

const EXPECTED_NON_SEMANTIC_INTEGRATION_PATHS = [
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
];

const EXPECTED_INTEGRATION_PREFIXES = [
  { path: "knowledge-fs/", workflowPattern: "knowledge-fs/**" },
  {
    path: "packages/contracts/generated/api/console/",
    workflowPattern: "packages/contracts/generated/api/console/**",
  },
  {
    path: "packages/contracts/generated/api/service/",
    workflowPattern: "packages/contracts/generated/api/service/**",
  },
];

test("secret scan reports high-confidence credentials without echoing their value", () => {
  const credential = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
  const findings = scanText({
    content: `export const credential = "${credential}";\n`,
    path: "apps/api/src/config.ts",
  });

  assert.deepEqual(
    findings.map(({ column, line, path, rule }) => ({ column, line, path, rule })),
    [
      {
        column: 28,
        line: 1,
        path: "apps/api/src/config.ts",
        rule: "aws-access-key-id",
      },
    ],
  );
  assert.match(findings[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(findings[0], "value"), false);
  assert.equal(JSON.stringify(findings).includes(credential), false);
});

test("secret scan recognizes JWTs and private keys", () => {
  const jwt = [
    "eyJhbGciOiJSUzI1NiJ9",
    "eyJzdWIiOiJwcm9kdWN0aW9uLXVzZXIifQ",
    "signature_material_that_is_long_enough",
  ].join(".");
  const privateKey = [
    ["-----BEGIN PRIVATE", " KEY-----"].join(""),
    "synthetic-key-material-for-a-secret-scan-unit-test",
    ["-----END PRIVATE", " KEY-----"].join(""),
  ].join("\n");
  const findings = scanText({
    content: `${jwt}\n${privateKey}\n`,
    path: "fixtures/input.txt",
  });

  assert.deepEqual(
    findings.map(({ line, rule }) => ({ line, rule })),
    [
      { line: 1, rule: "jwt" },
      { line: 2, rule: "private-key" },
    ],
  );
});

test("secret scan recognizes Dify KnowledgeFS credentials without flagging database names", () => {
  const credential = ["kfs_", "Aa0", "b".repeat(40)].join("");
  const findings = scanText({
    content: [
      `raw_credential = "${credential}"`,
      'index_name = "kfs_control_space_tenant_state_updated_idx"',
      'table_name = "kfs_capability_issuance_reservations"',
      'ann_table = "kfs_ann_dense_0123456789abcdef0123456789abcdef"',
    ].join("\n"),
    path: "api/services/knowledge_fs/credential_service.py",
  });

  assert.deepEqual(
    findings.map(({ line, rule }) => ({ line, rule })),
    [{ line: 1, rule: "dify-knowledge-fs-credential" }],
  );
});

test("secret scan accepts every valid character class distribution in a Dify credential", () => {
  const credentials = [
    ["kfs_", "a".repeat(43)].join(""),
    ["kfs_", "A".repeat(43)].join(""),
    ["kfs_", "7".repeat(43)].join(""),
    ["kfs_", "-".repeat(43)].join(""),
    ["kfs_", "aA".repeat(21), "_"].join(""),
  ];
  const findings = scanText({
    content: credentials.join("\n"),
    path: "api/services/knowledge_fs/credential_service.py",
  });

  assert.deepEqual(
    findings.map(({ line, rule }) => ({ line, rule })),
    credentials.map((_, index) => ({
      line: index + 1,
      rule: "dify-knowledge-fs-credential",
    })),
  );
});

test("integration surface keeps a complete auditable list of non-semantic touchpoints", () => {
  assert.deepEqual(KNOWLEDGE_FS_INTEGRATION_EXACT_PATHS, EXPECTED_NON_SEMANTIC_INTEGRATION_PATHS);
  assert.deepEqual(KNOWLEDGE_FS_INTEGRATION_PREFIXES, EXPECTED_INTEGRATION_PREFIXES);
  for (const path of EXPECTED_NON_SEMANTIC_INTEGRATION_PATHS) {
    assert.equal(isKnowledgeFsIntegrationPath(path), true, `scanner is missing ${path}`);
  }
  for (const prefix of EXPECTED_INTEGRATION_PREFIXES) {
    assert.equal(
      isKnowledgeFsIntegrationPath(`${prefix.path}representative-file.txt`),
      true,
      `scanner is missing ${prefix.path}`,
    );
  }
});

test("allowlist entries are exact, justified, and cannot exclude a whole production file", () => {
  const credential = ["ghp_", "abcdefghijklmnopqrstuvwxyz0123456789"].join("");
  const [finding] = scanText({
    content: `const token = "${credential}";\n`,
    path: "contracts/public-test-vector.json",
  });
  const allowlist = parseAllowlist({
    entries: [
      {
        fingerprint: finding.fingerprint,
        line: finding.line,
        path: finding.path,
        reason: "Published synthetic interoperability vector.",
        rule: finding.rule,
      },
    ],
    version: 1,
  });

  assert.deepEqual(evaluateFindings([finding], allowlist), {
    staleAllowlistEntries: [],
    unallowedFindings: [],
  });
  assert.throws(
    () =>
      parseAllowlist({
        entries: [
          {
            path: "apps/api/src/**",
            reason: "Do not scan production.",
            rule: "*",
          },
        ],
        version: 1,
      }),
    /exact path, line, rule, fingerprint, and reason/,
  );
});

test("changed or removed allowlisted values fail closed", () => {
  const token = ["xoxb-", "123456789012-abcdefghijklmnopqrstuvwxyz"].join("");
  const [finding] = scanText({ content: token, path: "contracts/vector.json" });
  const allowlist = parseAllowlist({
    entries: [
      {
        fingerprint: "0".repeat(64),
        line: finding.line,
        path: finding.path,
        reason: "Published synthetic interoperability vector.",
        rule: finding.rule,
      },
    ],
    version: 1,
  });

  const result = evaluateFindings([finding], allowlist);
  assert.deepEqual(result.unallowedFindings, [finding]);
  assert.deepEqual(result.staleAllowlistEntries, allowlist.entries);
});

test("directory scan includes production and test sources but skips build output", async () => {
  const root = await mkdtemp(join(tmpdir(), "knowledge-fs-secret-scan-"));
  try {
    await mkdir(join(root, "apps/api/src"), { recursive: true });
    await mkdir(join(root, "packages/api/src"), { recursive: true });
    await mkdir(join(root, "node_modules/vendor"), { recursive: true });
    await mkdir(join(root, "coverage"), { recursive: true });
    const productionToken = ["AIza", "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"].join("");
    const testToken = ["sk_live_", "abcdefghijklmnopqrstuvwxyz0123456789"].join("");
    await writeFile(join(root, "apps/api/src/config.ts"), productionToken);
    await writeFile(join(root, "packages/api/src/config.test.ts"), testToken);
    await writeFile(join(root, "node_modules/vendor/index.js"), productionToken);
    await writeFile(join(root, "coverage/report.json"), productionToken);

    const findings = await scanDirectory(root);

    assert.deepEqual(
      findings.map(({ path, rule }) => ({ path, rule })),
      [
        { path: "apps/api/src/config.ts", rule: "google-api-key" },
        { path: "packages/api/src/config.test.ts", rule: "stripe-live-secret" },
      ],
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("integration scan covers the complete KnowledgeFS and Dify integration surface", async () => {
  const root = await mkdtemp(join(tmpdir(), "knowledge-fs-integration-secret-scan-"));
  const token = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
  const expectedPaths = [
    "knowledge-fs/apps/api/src/config.ts",
    "api/app_factory.py",
    "api/controllers/console/knowledge_fs/resources.py",
    "api/extensions/ext_knowledge_fs_observability.py",
    "api/models/knowledge_fs.py",
    "api/repositories/sqlalchemy_knowledge_fs_control_space_repository.py",
    "api/services/knowledge_fs/credential_service.py",
    "api/tasks/knowledge_fs_lifecycle_tasks.py",
    "api/migrations/versions/2026_07_21_add_knowledge_fs.py",
    "docker/docker-compose.yaml",
    "docker/envs/core-services/knowledge-fs.env.example",
  ];

  try {
    for (const path of expectedPaths) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), token);
    }
    await mkdir(join(root, "api/services/unrelated"), { recursive: true });
    await writeFile(join(root, "api/services/unrelated/config.py"), token);

    const findings = await scanIntegrationSurface(root);

    assert.deepEqual(
      findings.map(({ path }) => path),
      expectedPaths.toSorted(),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
