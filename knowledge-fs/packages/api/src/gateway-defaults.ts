import { type ComputeRuntime, createTypeScriptComputeRuntime } from "@knowledge/compute";
import {
  type ParserAdapter,
  createNativeHtmlParser,
  createNativeMarkdownParser,
  createParserRouter,
} from "@knowledge/parsers";

export class KnowledgeFsUnavailableError extends Error {}

export function createDefaultParser(): ParserAdapter {
  return createParserRouter({
    html: createNativeHtmlParser(),
    markdown: createNativeMarkdownParser(),
    unstructured: {
      kind: "unstructured",
      parse: async () => {
        throw new Error("Unstructured parser is not configured");
      },
    },
  });
}

export function createDefaultComputeRuntime(): ComputeRuntime {
  return createTypeScriptComputeRuntime();
}
