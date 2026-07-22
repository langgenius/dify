import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_OUTPUT = "openapi/knowledge-fs.openapi.json";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

process.env.NODE_ENV = "test";
const [
  { createNodePlatformAdapter },
  { createKnowledgeGateway },
  { createInMemoryCapabilityGrantProvenanceRepository },
] = await Promise.all([
  import("../packages/adapters/src/node.ts"),
  import("../packages/api/src/index.ts"),
  import("../packages/api/src/capability-grant-provenance.ts"),
]);

const unavailableInContractExport = async () => {
  throw new Error("OpenAPI export does not execute runtime services");
};

const outputPath = resolve(argumentValue("--output") ?? DEFAULT_OUTPUT);
const app = createKnowledgeGateway({
  adapter: createNodePlatformAdapter({ env: {} }),
  capabilityGrantProvenance: createInMemoryCapabilityGrantProvenanceRepository(),
  difyCapabilityV2Auth: { authenticate: unavailableInContractExport },
  difyIntegrationFreezes: {
    freeze: unavailableInContractExport,
    get: unavailableInContractExport,
  },
  difyIntegrationStates: {
    activate: unavailableInContractExport,
    get: unavailableInContractExport,
  },
  legacyAccessMutationsReadOnly: true,
  legacyAuthorizationRemoved: true,
  uploadSessions: {
    abort: unavailableInContractExport,
    cleanupExpired: unavailableInContractExport,
    complete: unavailableInContractExport,
    create: unavailableInContractExport,
    get: unavailableInContractExport,
    presignPart: unavailableInContractExport,
    putSmallFile: unavailableInContractExport,
  },
});
const response = await app.request("/openapi.json");
if (!response.ok) {
  throw new Error(`OpenAPI export failed with HTTP ${response.status}`);
}

const document = await response.json();
const serialized = `${JSON.stringify(document, null, 2)}\n`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, serialized);
console.log(`Wrote OpenAPI artifact: ${outputPath}`);
