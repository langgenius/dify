import { Parser } from "htmlparser2";
import { ParserResourceLimitError, parserResourceLimits } from "./parser-resource-budget";

/** Only the current line is sliced; consumers can stop before materializing the remainder. */
export function* iterateDocumentLines(text: string, signal?: AbortSignal): Generator<string> {
  let offset = 0;
  while (true) {
    signal?.throwIfAborted();
    const end = text.indexOf("\n", offset);
    if (end < 0) {
      yield text.slice(offset);
      return;
    }
    yield text.slice(offset, end);
    offset = end + 1;
  }
}

/** SAX admission is independent from the authoritative XML projection; no DOM is constructed. */
export function assertXmlStructureBudget(
  text: string,
  options: {
    readonly maxDepth?: number;
    readonly maxNodes?: number;
    readonly signal?: AbortSignal | undefined;
  } = {},
): void {
  const maxDepth = options.maxDepth ?? parserResourceLimits.maxDepth;
  const maxNodes = options.maxNodes ?? parserResourceLimits.maxNodes;
  if (
    !Number.isSafeInteger(maxDepth) ||
    maxDepth < 1 ||
    !Number.isSafeInteger(maxNodes) ||
    maxNodes < 1
  )
    throw new ParserResourceLimitError("invalid XML admission budget");
  options.signal?.throwIfAborted();
  let depth = 0;
  let nodes = 0;
  const consumeNode = () => {
    nodes += 1;
    if (nodes > maxNodes) throw new ParserResourceLimitError("XML node count");
  };
  const parser = new Parser(
    {
      onopentagname() {
        depth += 1;
        if (depth > maxDepth) throw new ParserResourceLimitError("XML nesting depth");
        consumeNode();
      },
      onattribute: consumeNode,
      ontext(value) {
        // Match the authoritative projection's default trimValues behavior: indentation alone
        // must not make a pretty-printed file consume twice the compact file's node budget.
        if (value.trim()) consumeNode();
      },
      onprocessinginstruction: consumeNode,
      onclosetag() {
        depth -= 1;
      },
    },
    { decodeEntities: false, xmlMode: true },
  );
  for (let offset = 0; offset < text.length; offset += 64 * 1024) {
    options.signal?.throwIfAborted();
    parser.write(text.slice(offset, offset + 64 * 1024));
  }
  parser.end();
  options.signal?.throwIfAborted();
}
