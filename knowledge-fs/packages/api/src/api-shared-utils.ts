import { createHash } from "node:crypto";

import type { TextDiffOperation } from "@knowledge/compute";
import { type EvidenceBundle, EvidenceBundleSchema } from "@knowledge/core";

export function deterministicChildId(parentId: string, seed: string): string {
  const hex = createHash("sha256").update(`${parentId}:${seed}`).digest("hex");
  const variant = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export function cloneEvidenceBundle(bundle: EvidenceBundle): EvidenceBundle {
  return EvidenceBundleSchema.parse(JSON.parse(JSON.stringify(bundle)));
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function cloneTextDiffOperation(operation: TextDiffOperation): TextDiffOperation {
  return JSON.parse(JSON.stringify(operation)) as TextDiffOperation;
}
