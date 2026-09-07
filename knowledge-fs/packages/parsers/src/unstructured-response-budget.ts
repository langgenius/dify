import {
  ParserResourceLimitError,
  assertJsonDepth,
  assertParserResourceBudget,
  parserResourceLimits,
} from "./parser-resource-budget";

/**
 * The transport has already bounded response bytes. Check JSON depth before decoding and the raw
 * tree before schema cloning or normalization: filtering empty/noisy elements later is not an
 * admission policy. Provider output gets the larger artifact-node budget, not the native-record
 * budget, so ordinary coordinate metadata remains compatible with the final element limit.
 */
export function parseUnstructuredResponsePayload(
  text: string,
  options: {
    readonly maxResponseBytes: number;
    readonly signal?: AbortSignal | undefined;
  },
): unknown {
  assertJsonDepth(text, options.signal);
  const payload: unknown = JSON.parse(text);
  if (Array.isArray(payload) && payload.length > parserResourceLimits.maxRawElements) {
    throw new ParserResourceLimitError("raw provider element count");
  }
  assertParserResourceBudget(payload, {
    maxBytes: options.maxResponseBytes,
    maxNodes: parserResourceLimits.maxArtifactNodes,
    signal: options.signal,
  });
  return payload;
}
