import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

import {
  KNOWLEDGE_FS_INTEGRATION_EXACT_PATHS,
  KNOWLEDGE_FS_INTEGRATION_PREFIXES,
} from "./secret-scan.mjs";

const workflow = readFileSync(
  new URL("../../.github/workflows/knowledge-fs-ci.yml", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const apiPackageJson = JSON.parse(
  readFileSync(new URL("../packages/api/package.json", import.meta.url), "utf8"),
);
const lockfile = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
const dependabot = readFileSync(new URL("../../.github/dependabot.yml", import.meta.url), "utf8");
const workflowDocument = parse(workflow);
const pathsFilterStep = workflowDocument.jobs["check-changes"].steps.find((step) =>
  step.uses?.startsWith("dorny/paths-filter@"),
);
const knowledgeFsWorkflowPaths = parse(pathsFilterStep.with.filters)["knowledge-fs"];
const qualitySteps = workflowDocument.jobs.quality.steps;

function qualityStep(name) {
  const step = qualitySteps.find((candidate) => candidate.name === name);
  assert.ok(step, `workflow is missing the ${name} step`);
  return step;
}

test("root workflow always emits a stable PR and merge-queue gate", () => {
  assert.match(workflow, /^name: KnowledgeFS CI$/m);
  assert.match(workflow, /^ {2}pull_request:$/m);
  assert.match(workflow, /^ {2}merge_group:$/m);
  assert.match(workflow, /^ {4}types: \[checks_requested\]$/m);
  assert.match(workflow, /^ {2}push:$/m);
  assert.match(workflow, /^ {2}workflow_dispatch:$/m);
  assert.doesNotMatch(workflow, /^ {4}paths:$/m);
  assert.match(workflow, /^ {2}final:$/m);
  assert.match(workflow, /^ {4}name: KnowledgeFS CI$/m);
  assert.match(workflow, /^ {4}if: \$\{\{ always\(\) \}\}$/m);
  assert.match(workflow, /^concurrency:$/m);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.deepEqual(workflowDocument.on.push.branches, ["main", "deploy/konwledge"]);
});

test("root workflow scopes expensive checks internally", () => {
  assert.match(workflow, /uses: dorny\/paths-filter@[0-9a-f]{40}/);
  assert.match(workflow, /- 'knowledge-fs\/\*\*'/);
  assert.match(workflow, /- 'knowledge-fs\/packages\/api\/src\/dify-capability-v2\.ts'/);
  assert.match(workflow, /- 'knowledge-fs\/scripts\/export-openapi\.mjs'/);
  assert.match(workflow, /- 'api\/dev\/generate_knowledge_fs_contract\.py'/);
  assert.match(workflow, /- 'api\/dev\/knowledge_fs_product_contract\.py'/);
  assert.match(workflow, /- 'api\/knowledge-fs-product-operation-gaps\.json'/);
  assert.match(workflow, /- 'api\/knowledge-fs-product-operations\.json'/);
  assert.match(workflow, /- 'api\/services\/knowledge_fs\/\*\*'/);
  assert.match(workflow, /- 'api\/\*\*\/knowledge_fs\/\*\*'/);
  assert.match(workflow, /- 'api\/\*\*\/\*knowledge_fs\*'/);
  assert.match(workflow, /- 'api\/\*\*\/\*knowledge-fs\*'/);
  assert.match(workflow, /- 'api\/app_factory\.py'/);
  assert.match(workflow, /- 'api\/models\/__init__\.py'/);
  assert.match(workflow, /- 'api\/controllers\/console\/__init__\.py'/);
  assert.match(workflow, /- 'api\/controllers\/service_api\/__init__\.py'/);
  assert.doesNotMatch(workflow, /- 'web\//);
  assert.match(workflow, /- 'docker\/\.env\.example'/);
  assert.match(workflow, /- 'docker\/README\.md'/);
  assert.match(workflow, /- 'docker\/docker-compose-template\.yaml'/);
  assert.match(workflow, /- 'docker\/docker-compose\.yaml'/);
  assert.match(workflow, /- 'docker\/envs\/core-services\/api\.env\.example'/);
  assert.match(workflow, /- 'docker\/envs\/core-services\/knowledge-fs\.env\.example'/);
  assert.match(workflow, /- 'docker\/generate_docker_compose'/);
  assert.match(workflow, /- 'docs\/design\/knowledge-fs\*'/);
  assert.match(workflow, /- 'api\/pyproject\.toml'/);
  assert.match(workflow, /- 'api\/uv\.lock'/);
  assert.match(workflow, /- '\.github\/dependabot\.yml'/);
  assert.match(workflow, /needs\.check-changes\.outputs\.knowledge-fs == 'true'/);
  assert.match(workflow, /^ {2}skip:$/m);
});

test("workflow paths stay in parity with every auditable integration touchpoint", () => {
  for (const path of KNOWLEDGE_FS_INTEGRATION_EXACT_PATHS) {
    assert.ok(knowledgeFsWorkflowPaths.includes(path), `workflow path filter is missing ${path}`);
  }
  for (const prefix of KNOWLEDGE_FS_INTEGRATION_PREFIXES) {
    assert.ok(
      knowledgeFsWorkflowPaths.includes(prefix.workflowPattern),
      `workflow path filter is missing ${prefix.workflowPattern}`,
    );
  }
});

test("root workflow and Dependabot configuration are valid YAML", () => {
  assert.doesNotThrow(() => parse(workflow));
  assert.doesNotThrow(() => parse(dependabot));
});

test("root workflow preserves the independent KnowledgeFS pnpm workspace", () => {
  assert.equal(packageJson.packageManager, "pnpm@10.33.0");
  assert.match(workflow, /working-directory: \.\/knowledge-fs/);
  assert.match(workflow, /package_json_file: knowledge-fs\/package\.json/);
  assert.match(workflow, /cache-dependency-path: knowledge-fs\/pnpm-lock\.yaml/);
  assert.match(workflow, /node-version: 22/);
  assert.match(workflow, /run: pnpm install --frozen-lockfile/);
  assert.match(workflow, /run: pnpm check/);
  assert.match(workflow, /run: pnpm build/);
  assert.match(workflow, /run: pnpm lint:backend/);
  assert.doesNotMatch(workflow, /cache-dependency-path: pnpm-lock\.yaml/);
  assert.match(packageJson.scripts.check, /pnpm compose:middleware:config/);
  assert.match(packageJson.scripts.check, /pnpm compose:config/);
  assert.match(packageJson.scripts.check, /pnpm dify:compose:config/);
  assert.equal(packageJson.scripts["dify:compose:config"], "node scripts/dify-compose-config.mjs");
  assert.equal(packageJson.scripts["lint:backend"], "biome check apps/api packages scripts");
});

test("root workflow runs explicit local security gates", () => {
  assert.match(workflow, /name: Scan KnowledgeFS secrets\s+run: pnpm security:secrets/);
  assert.match(
    workflow,
    /name: Audit KnowledgeFS production dependencies\s+run: pnpm security:dependencies/,
  );
  assert.equal(packageJson.scripts["security:secrets"], "node scripts/secret-scan.mjs");
  assert.equal(
    packageJson.scripts["security:dependencies"],
    "pnpm audit --prod --audit-level high",
  );
  assert.match(packageJson.scripts["ci:workflow:test"], /scripts\/secret-scan\.test\.mjs/);
});

test("production dependency security fixes stay locked", () => {
  assert.equal(apiPackageJson.dependencies.sharp, "^0.35.3");
  assert.equal(packageJson.pnpm.overrides["fast-uri"], "3.1.4");
  assert.equal(packageJson.pnpm.overrides.sharp, "0.35.3");
  assert.match(lockfile, /^ {2}fast-uri@3\.1\.4:$/m);
  assert.doesNotMatch(lockfile, /^ {2}fast-uri@3\.1\.2:$/m);
  assert.match(lockfile, /^ {2}sharp@0\.35\.3:$/m);
  assert.doesNotMatch(lockfile, /^ {2}sharp@0\.34\.5:$/m);
});

test("Dependabot covers the independent KnowledgeFS pnpm workspace", () => {
  const config = parse(dependabot);
  const update = config.updates.find(
    (candidate) =>
      candidate["package-ecosystem"] === "npm" && candidate.directory === "/knowledge-fs",
  );

  assert.ok(update);
  assert.equal(update.schedule.interval, "weekly");
  assert.ok(update["open-pull-requests-limit"] > 0);
});

test("root workflow installs the locked Dify environment and checks the contract", () => {
  assert.match(workflow, /uv lock --project api --check/);
  assert.match(workflow, /uv sync --project api --locked --dev/);
  assert.match(
    qualityStep("Collect Dify KnowledgeFS gate targets").run,
    /find api\/tests\/unit_tests[\s\S]*knowledge_fs/,
  );
  assert.match(
    workflow,
    /uv run --project api python api\/dev\/generate_knowledge_fs_contract\.py --check/,
  );
  assert.equal(
    packageJson.scripts["openapi:export"],
    "node --import tsx scripts/export-openapi.mjs",
  );
});

test("root workflow fail-closed collects the complete Dify KnowledgeFS gate surface", () => {
  const collectTargets = qualityStep("Collect Dify KnowledgeFS gate targets");

  assert.equal(collectTargets["working-directory"], ".");
  assert.match(collectTargets.run, /set -euo pipefail/);
  assert.match(collectTargets.run, /find api[\s\S]*-path 'api\/tests'[\s\S]*-name '\*\.py'/);
  assert.match(collectTargets.run, /\[\[ "\$path" == \*knowledge_fs\* \]\]/);
  assert.match(collectTargets.run, /find api\/tests\/unit_tests[\s\S]*-name '\*\.py'/);

  for (const path of [
    "api/app_factory.py",
    "api/commands/__init__.py",
    "api/controllers/console/__init__.py",
    "api/controllers/console/workspace/rbac.py",
    "api/controllers/service_api/__init__.py",
    "api/core/agent/base_agent_runner.py",
    "api/core/app/apps/agent_app/runtime_request_builder.py",
    "api/core/rbac/entities.py",
    "api/core/tools/__base/tool_runtime.py",
    "api/core/workflow/node_runtime.py",
    "api/core/workflow/nodes/agent_v2/runtime_request_builder.py",
    "api/extensions/ext_celery.py",
    "api/extensions/ext_commands.py",
    "api/models/__init__.py",
    "api/services/account_service.py",
    "api/services/agent_tool_inner_service.py",
    "api/services/enterprise/rbac_service.py",
    "api/services/entities/agent_tool_inner.py",
  ]) {
    assert.match(collectTargets.run, new RegExp(path.replaceAll("/", "\\/")));
  }

  for (const path of [
    "api/tests/unit_tests/controllers/console/workspace/test_rbac.py",
    "api/tests/unit_tests/core/agent/test_base_agent_runner.py",
    "api/tests/unit_tests/core/app/apps/agent_app/test_runtime_request_builder.py",
    "api/tests/unit_tests/core/workflow/nodes/agent_v2/test_runtime_request_builder.py",
    "api/tests/unit_tests/core/workflow/nodes/tool/test_tool_node_runtime.py",
    "api/tests/unit_tests/core/workflow/test_node_runtime.py",
    "api/tests/unit_tests/services/enterprise/test_rbac_service.py",
    "api/tests/unit_tests/services/test_account_service.py",
    "api/tests/unit_tests/services/test_agent_tool_inner_service.py",
  ]) {
    assert.match(collectTargets.run, new RegExp(path.replaceAll("/", "\\/")));
  }

  for (const requiredScope of [
    "/commands/",
    "/configs/",
    "/controllers/",
    "/core/agent/",
    "/core/app/apps/agent_app/",
    "/core/tools/builtin_tool/providers/knowledge_fs/",
    "/core/workflow/",
    "/dev/",
    "/extensions/",
    "/migrations/",
    "/models/",
    "/repositories/",
    "/services/",
    "/tasks/",
  ]) {
    assert.match(collectTargets.run, new RegExp(requiredScope.replaceAll("/", "\\/")));
  }

  assert.match(collectTargets.run, /production target set is empty/);
  assert.match(collectTargets.run, /production_touchpoints\[@\][\s\S]*glue-files/);
  assert.match(collectTargets.run, /unit test target set is empty/);
  assert.match(collectTargets.run, /required Dify KnowledgeFS test scope is empty/);
});

test("root workflow runs Dify Ruff, Pyrefly, Mypy, and the full KnowledgeFS unit surface", () => {
  const lint = qualityStep("Lint Dify KnowledgeFS integration");
  const typecheck = qualityStep("Type-check Dify KnowledgeFS integration");
  const unitTests = qualityStep("Test Dify KnowledgeFS unit surface");

  assert.equal(lint["working-directory"], ".");
  assert.match(lint.run, /ruff format --check/);
  assert.match(lint.run, /ruff check/);
  assert.match(lint.run, /production-files/);

  assert.equal(typecheck["working-directory"], ".");
  assert.match(typecheck.run, /\.\/dev\/pyrefly-check-local/);
  assert.match(typecheck.run, /PYREFLY_OUTPUT_FORMAT=github/);
  assert.match(typecheck.run, /uv run --directory api --dev mypy/);
  assert.match(typecheck.run, /--check-untyped-defs/);
  assert.match(typecheck.run, /production-files/);

  assert.equal(unitTests["working-directory"], ".");
  assert.match(
    unitTests.run,
    /coverage run --branch --source=api -m pytest "\$\{targets\[@\]\}" --no-cov -q/,
  );
  assert.match(unitTests.run, /unit-test-files/);
  assert.doesNotMatch(
    unitTests.run,
    /pytest\s+api\/tests\/unit_tests\/dev\/test_generate_knowledge_fs_contract\.py/,
  );
});

test("root workflow enforces focused Dify line, branch, and changed-glue coverage", () => {
  const changeCheckout = workflowDocument.jobs["check-changes"].steps.find(
    (step) => step.name === "Checkout code",
  );
  const checkout = qualityStep("Checkout code");
  const unitTests = qualityStep("Test Dify KnowledgeFS unit surface");
  const coverage = qualityStep("Enforce Dify KnowledgeFS focused coverage");

  assert.equal(changeCheckout.with["fetch-depth"], 0);
  assert.equal(checkout.with["fetch-depth"], 0);
  assert.match(unitTests.env.COVERAGE_FILE, /dify-knowledge-fs\.coverage/);
  assert.match(coverage.env.COVERAGE_FILE, /dify-knowledge-fs\.coverage/);
  assert.match(coverage.run, /coverage json --show-contexts/);
  assert.match(coverage.run, /api\/dev\/check_knowledge_fs_coverage\.py/);
  assert.match(coverage.run, /--glue-manifest[\s\S]*knowledge-fs-ci-targets\/glue-files/);
  assert.match(coverage.run, /--minimum 90/);
  assert.match(coverage.run, /--glue-minimum 90/);
  assert.match(
    coverage.env.KNOWLEDGE_FS_COVERAGE_BASE,
    /github\.event\.pull_request\.base\.sha[\s\S]*github\.event\.before/,
  );
});

test("root workflow directly gates the Dify Agent KnowledgeFS core-tool callback", () => {
  const verifyLock = qualityStep("Verify Dify Agent dependency lock");
  const install = qualityStep("Install Dify Agent gate dependencies");
  const lint = qualityStep("Lint Dify Agent KnowledgeFS integration");
  const typecheck = qualityStep("Type-check Dify Agent KnowledgeFS integration");
  const unitTests = qualityStep("Test Dify Agent KnowledgeFS integration");

  assert.match(verifyLock.run, /uv lock --project dify-agent --check/);
  assert.match(install.run, /uv sync --project dify-agent --locked --dev/);
  for (const step of [lint, typecheck, unitTests]) {
    assert.equal(step["working-directory"], "./dify-agent");
    assert.match(step.run, /tests\/local\/dify_agent\/layers\/dify_core_tools\/test_client\.py/);
  }
  for (const step of [lint, typecheck]) {
    assert.match(step.run, /src\/dify_agent\/layers\/dify_core_tools\/client\.py/);
  }
  assert.match(lint.run, /ruff format --check/);
  assert.match(lint.run, /ruff check/);
  assert.match(typecheck.run, /basedpyright --level error/);
  assert.match(unitTests.run, /pytest[\s\S]*-q/);
});

test("root workflow builds the KnowledgeFS API image and publishes only trusted revisions", () => {
  const build = workflowDocument.jobs.build;
  assert.ok(build, "workflow is missing the KnowledgeFS API image build job");
  assert.equal(build.name, "Build KnowledgeFS API production image");
  assert.deepEqual(build.needs, ["check-changes", "quality"]);
  assert.match(build.if, /needs\.check-changes\.outputs\.knowledge-fs == 'true'/);
  assert.match(build.if, /needs\.quality\.result == 'success'/);
  assert.match(
    workflowDocument.env.DIFY_KNOWLEDGE_FS_API_IMAGE_NAME,
    /vars\.DIFY_KNOWLEDGE_FS_API_IMAGE_NAME.*langgenius\/dify-knowledge-fs-api/,
  );

  const checkout = build.steps.find((step) => step.name === "Checkout code");
  const setupBuildx = build.steps.find((step) => step.name === "Set up Docker Buildx");
  const login = build.steps.find((step) => step.name === "Login to Docker Hub");
  const metadata = build.steps.find((step) => step.name === "Extract KnowledgeFS image metadata");
  const buildImage = build.steps.find((step) => step.name === "Build KnowledgeFS API image");

  assert.equal(checkout.with["persist-credentials"], false);
  assert.match(setupBuildx.uses, /^docker\/setup-buildx-action@[0-9a-f]{40}$/);
  assert.match(login.uses, /^docker\/login-action@[0-9a-f]{40}$/);
  assert.match(login.if, /workflow_dispatch.*push.*refs\/heads\/main/);
  assert.match(login.if, /refs\/heads\/deploy\/konwledge/);
  assert.equal(login.with.username, "${{ secrets.DOCKERHUB_USER }}");
  assert.equal(login.with.password, "${{ secrets.DOCKERHUB_TOKEN }}");
  assert.match(metadata.uses, /^docker\/metadata-action@[0-9a-f]{40}$/);
  assert.equal(metadata.with.images, "${{ env.DIFY_KNOWLEDGE_FS_API_IMAGE_NAME }}");
  assert.match(metadata.with.tags, /type=raw,value=latest/);
  assert.match(metadata.with.tags, /type=sha,format=long/);
  assert.match(buildImage.uses, /^docker\/build-push-action@[0-9a-f]{40}$/);
  assert.equal(buildImage.with.context, "./knowledge-fs");
  assert.equal(buildImage.with.file, "./knowledge-fs/apps/api/Dockerfile");
  assert.equal(buildImage.with.platforms, "linux/amd64");
  assert.match(buildImage.with.push, /workflow_dispatch.*push.*refs\/heads\/main/);
  assert.match(buildImage.with.push, /refs\/heads\/deploy\/konwledge/);
  assert.equal(buildImage.with.tags, "${{ steps.meta.outputs.tags }}");
  assert.equal(buildImage.with.labels, "${{ steps.meta.outputs.labels }}");
  assert.doesNotMatch(JSON.stringify(build), /apps\/admin/);

  const final = workflowDocument.jobs.final;
  assert.ok(final.needs.includes("build"));
  assert.equal(final.steps[0].env.BUILD_RESULT, "${{ needs.build.result }}");
  assert.match(final.steps[0].run, /"\$BUILD_RESULT" == 'success'/);
});

test("root workflow uses least privilege and pinned third-party actions", () => {
  assert.match(workflow, /^ {2}contents: read$/m);
  assert.match(workflow, /^ {2}pull-requests: read$/m);
  assert.equal(workflow.match(/persist-credentials: false/g)?.length, 3);

  const usesLines = workflow
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("uses:"));
  const actionNames = usesLines.map((line) => line.slice("uses: ".length).split("@")[0]);

  assert.deepEqual(
    new Set(actionNames),
    new Set([
      "actions/checkout",
      "actions/setup-node",
      "astral-sh/setup-uv",
      "dorny/paths-filter",
      "docker/build-push-action",
      "docker/login-action",
      "docker/metadata-action",
      "docker/setup-buildx-action",
      "pnpm/action-setup",
    ]),
  );
  for (const line of usesLines) {
    assert.match(line, /@[0-9a-f]{40}(?:\s+#.*)?$/);
  }
});
