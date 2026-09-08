import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse, parseAllDocuments } from "yaml";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const template = parse(read("../../docker/docker-compose-template.yaml"), { merge: true });
const roles = ["document", "source", "research", "maintenance", "dispatch"];

test("generated Compose preserves the five isolated, opt-in Celery roles", () => {
  const generated = parse(read("../../docker/docker-compose.yaml"), { merge: true });
  for (const role of roles) {
    const name = `knowledge_fs_${role}_worker`;
    const worker = template.services[name];
    assert.deepEqual(generated.services[name], worker);
    assert.deepEqual(worker.profiles, ["knowledge-fs-celery"]);
    assert.equal(worker.environment.CELERY_WORKER_POOL, "prefork");
    assert.equal(worker.environment.CELERY_PREFETCH_MULTIPLIER, "1");
    assert.equal(worker.environment.CELERY_WORKER_QUEUES, `knowledge_fs_${role}`);
    assert.equal(worker.environment.MIGRATION_ENABLED, "false");
    assert.equal(worker.ports, undefined);
    assert.equal(worker.env_file.at(-1), "./.env");
    assert.match(worker.image, /KNOWLEDGE_FS_WORKER_IMAGE/u);
  }
  assert.ok(
    template.services.knowledge_fs.environment.DIFY_ROOT_KNOWLEDGE_BACKGROUND_EXECUTION_OVERRIDE,
  );
});

test("Kubernetes roles use one inert independently scalable deployment per queue", () => {
  const objects = parseAllDocuments(read("../infra/kubernetes/celery-workers.yaml")).map((doc) =>
    doc.toJSON(),
  );
  const deployments = objects.filter((object) => object.kind === "Deployment");
  assert.equal(deployments.length, 5);
  for (const role of roles) {
    const deployment = deployments.find(
      (object) => object.metadata.name === `knowledge-fs-${role}-worker`,
    );
    assert.equal(deployment.spec.replicas, 0);
    const pod = deployment.spec.template;
    assert.deepEqual(deployment.spec.selector.matchLabels, {
      "app.kubernetes.io/name": pod.metadata.labels["app.kubernetes.io/name"],
    });
    const container = pod.spec.containers[0];
    assert.equal(container.ports, undefined);
    assert.ok(container.resources.limits.memory);
    assert.ok(
      container.env.some(
        (value) => value.name === "CELERY_WORKER_QUEUES" && value.value === `knowledge_fs_${role}`,
      ),
    );
  }
});

test("every engine sweep has a Celery scheduler route, and deliveries are not swept", () => {
  const registry = read("../packages/api/src/background-runtime-controller.ts").split(
    "] as const;",
  )[0];
  const names = [...registry.matchAll(/"([a-z-]+\.[a-z-]+)"/gu)].map((match) => match[1]);
  const contract = read("../../api/services/knowledge_fs/background_contract.py");
  const scheduled = [...contract.matchAll(/"([a-z-]+\.[a-z-]+)": [A-Z_]+,/gu)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    scheduled.sort(),
    names.filter((name) => !["document.execute", "page-index.findability"].includes(name)).sort(),
  );
});

test("shared API image bundles all engine processes without runtime downloads or env files", () => {
  const dockerfile = read("../../api/Dockerfile");
  for (const bundle of [
    "celery-worker.mjs",
    "native-parser-worker.mjs",
    "image-variant-worker.mjs",
  ]) {
    assert.ok(dockerfile.includes(`/app/knowledge-fs/${bundle}`));
  }
  assert.ok(dockerfile.includes("poppler-utils"));
  assert.ok(dockerfile.includes("/app/knowledge-fs/node_modules"));
  const ignore = read("../../api/Dockerfile.dockerignore");
  for (const pattern of ["**/.env", "**/*.env", "**/*.env.*", "**/node_modules/", "**/dist/"]) {
    assert.ok(ignore.split("\n").includes(pattern));
  }
});
