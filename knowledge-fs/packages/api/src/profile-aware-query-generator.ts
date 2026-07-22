import type {
  QueryGenerationEvent,
  QueryGenerationInput,
  QueryGenerator,
} from "./gateway-sse-responses";

export interface ProfileAwareQueryGeneratorOptions {
  /** Evidence-only generator used by knowledge spaces that predate retrieval profiles. */
  readonly extractiveGenerator: QueryGenerator;
  /** Optional deployment-level LLM generator kept for backwards compatibility. */
  readonly legacyLlmGenerator?: QueryGenerator | undefined;
  /** Dynamic LLM generator capable of resolving each profile's reasoning model. */
  readonly profileLlmGenerator?: QueryGenerator | undefined;
}

/**
 * Selects answer synthesis without letting a configured space silently lose its reasoning model.
 *
 * A versioned retrieval profile is an explicit user choice, so its reasoning model must be served
 * by the dynamic LLM capability. Legacy spaces keep the historical deployment-level LLM or
 * extractive behavior.
 */
export function createProfileAwareQueryGenerator({
  extractiveGenerator,
  legacyLlmGenerator,
  profileLlmGenerator,
}: ProfileAwareQueryGeneratorOptions): QueryGenerator {
  return {
    stream: async function* (input: QueryGenerationInput): AsyncGenerator<QueryGenerationEvent> {
      if (input.retrievalProfile) {
        if (!profileLlmGenerator) {
          throw new ReasoningCapabilityUnavailableError(
            "Knowledge-space reasoning model is configured, but dynamic reasoning is unavailable",
          );
        }

        yield* profileLlmGenerator.stream(input);
        return;
      }

      yield* (legacyLlmGenerator ?? extractiveGenerator).stream(input);
    },
  };
}

export class ReasoningCapabilityUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReasoningCapabilityUnavailableError";
  }
}
