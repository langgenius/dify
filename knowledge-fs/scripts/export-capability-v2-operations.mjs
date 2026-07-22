import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DIFY_CAPABILITY_V2_OPERATIONS } from "../packages/api/src/dify-capability-v2.ts";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

const outputPath = resolve(
  argumentValue("--output") ?? "contracts/dify-capability-v2-operations.json",
);
const document = {
  schemaVersion: 1,
  operations: DIFY_CAPABILITY_V2_OPERATIONS.map((operation) => ({
    action: operation.action,
    allowedCallerKinds: [...operation.allowedCallerKinds],
    method: operation.method,
    operationId: operation.operationId,
    parentResourceBinding: operation.parentResource ?? null,
    path: operation.pathTemplate,
    resourceBinding: operation.resource,
    resourceType: operation.resourceType,
  })).sort((left, right) => left.operationId.localeCompare(right.operationId)),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Wrote Capability v2 operation policy: ${outputPath}`);
