import {
  type DurableDeletionRepository,
  type SourceBulkRemovalRequester,
  createDurableSourceBulkRemovalRequester,
} from "@knowledge/api";

export function createApiSourceBulkRemovalRequester(input: {
  readonly production: boolean;
  readonly repository?: DurableDeletionRepository | undefined;
}): SourceBulkRemovalRequester | undefined {
  if (!input.repository) {
    if (input.production) {
      throw new Error("Production Source bulk removal requires the durable deletion repository");
    }
    return undefined;
  }
  return createDurableSourceBulkRemovalRequester({ repository: input.repository });
}
