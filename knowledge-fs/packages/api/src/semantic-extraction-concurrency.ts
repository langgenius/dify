import { createConcurrencyGate } from "./bounded-concurrency";

/** Protects the shared model runtime across all entity and relation extraction providers. */
export const semanticExtractionModelRequestGate = createConcurrencyGate(4);
