import { Buffer } from "node:buffer";

export const parserResourceLimits = Object.freeze({
  maxDepth: 128,
  maxNodes: 250_000,
  maxOutputBytes: 32 * 1024 * 1024,
  maxRawElements: 50_000,
  maxArtifactNodes: 1_000_000,
  maxTableCells: 500_000,
  maxTableColumns: 4_096,
});

/** Stable input classification without a dependency on the parser facade. */
export class ParserResourceLimitError extends Error {
  readonly code = "provider_input";
  readonly retryable = false;
  constructor(limit: string) {
    super(
      `Document parser resource limit exceeded: ${limit}. Reduce the document structure or split the input.`,
    );
    this.name = "ParserResourceLimitError";
  }
}

/** A non-recursive, allocation-free structural pass before recursive JSON decoding. */
export function assertJsonDepth(text: string, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    if ((index & 4095) === 0) signal?.throwIfAborted();
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "[" || character === "{") {
      depth += 1;
      if (depth > parserResourceLimits.maxDepth)
        throw new ParserResourceLimitError("JSON nesting depth");
    } else if (character === "]" || character === "}") depth -= 1;
  }
}

export function assertParserResourceBudget(
  value: unknown,
  options: {
    readonly maxBytes?: number;
    readonly maxNodes?: number;
    readonly signal?: AbortSignal | undefined;
  } = {},
): void {
  options.signal?.throwIfAborted();
  const maxBytes = options.maxBytes ?? parserResourceLimits.maxOutputBytes;
  const maxNodes = options.maxNodes ?? parserResourceLimits.maxNodes;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    !Number.isSafeInteger(maxNodes) ||
    maxNodes < 1
  ) {
    throw new ParserResourceLimitError("invalid resource budget");
  }
  const pending = [{ value, depth: 0 }];
  let bytes = 0;
  let nodes = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) break;
    nodes += 1;
    if ((nodes & 4095) === 0) options.signal?.throwIfAborted();
    if (nodes > maxNodes || entry.depth > parserResourceLimits.maxDepth) {
      throw new ParserResourceLimitError("expanded node count or depth");
    }
    const current = entry.value;
    if (typeof current === "string") bytes += serializedStringBytes(current);
    else if (current !== null && typeof current === "object") {
      bytes += 2;
      let count = 0;
      for (const key in current) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
        if (count > 0) bytes += 1;
        if (!Array.isArray(current)) bytes += serializedStringBytes(key) + 1;
        pending.push({ value: (current as Record<string, unknown>)[key], depth: entry.depth + 1 });
        count += 1;
        if (nodes + pending.length > maxNodes || bytes > maxBytes)
          throw new ParserResourceLimitError("expanded node count or bytes");
      }
    } else bytes += String(current).length;
    if (bytes > maxBytes) throw new ParserResourceLimitError("expanded output bytes");
  }
}

function serializedStringBytes(value: string): number {
  let bytes = Buffer.byteLength(value, "utf8") + 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 34 || code === 92) bytes += 1;
    else if (code < 32) bytes += [8, 9, 10, 12, 13].includes(code) ? 1 : 5;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
      else bytes += 3;
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 3;
  }
  return bytes;
}
