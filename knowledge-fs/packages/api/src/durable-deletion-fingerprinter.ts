import { createHmac } from "node:crypto";

export const DurableDeletionFingerprintPurposes = [
  "name_challenge",
  "request_payload",
  "retry_request",
  "inventory_payload",
  "error_diagnostic",
] as const;
export type DurableDeletionFingerprintPurpose = (typeof DurableDeletionFingerprintPurposes)[number];

export interface DurableDeletionFingerprintInput {
  readonly knowledgeSpaceId: string;
  /** Initial requests use Idempotency-Key; retry requests use jobId + retry Idempotency-Key. */
  readonly operationKey: string;
  readonly purpose: DurableDeletionFingerprintPurpose;
  readonly tenantId: string;
  readonly value: string;
}

export type DurableDeletionFingerprinter = (input: DurableDeletionFingerprintInput) => string;

/**
 * Keyed, domain-separated digests prevent offline guessing of low-entropy space names and keep
 * request fingerprints unlinkable across tenants, spaces, jobs, and purposes.
 */
export function createDurableDeletionFingerprinter(
  deploymentKey: Uint8Array,
): DurableDeletionFingerprinter {
  if (!(deploymentKey instanceof Uint8Array) || deploymentKey.byteLength < 32) {
    throw new Error("Durable deletion fingerprint deployment key must be at least 32 bytes");
  }
  const key = Uint8Array.from(deploymentKey);
  return (input) => {
    const fields = [
      "knowledge-fs/durable-deletion/v1",
      requiredField(input.purpose, "purpose"),
      requiredField(input.tenantId, "tenantId"),
      requiredField(input.knowledgeSpaceId, "knowledgeSpaceId"),
      requiredField(input.operationKey, "operationKey"),
      input.value,
    ];
    const hmac = createHmac("sha256", key);
    for (const field of fields) {
      const bytes = Buffer.from(field, "utf8");
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(bytes.byteLength);
      hmac.update(length);
      hmac.update(bytes);
    }
    return hmac.digest("hex");
  };
}

function requiredField(value: string, field: string): string {
  if (!value || value !== value.trim() || value.length > 512) {
    throw new Error(`Durable deletion fingerprint ${field} is invalid`);
  }
  return value;
}
