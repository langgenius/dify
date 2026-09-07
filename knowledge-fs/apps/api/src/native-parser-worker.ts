import {
  createNativeHtmlParser,
  createNativeMarkdownParser,
  createNativeStructuredDataParser,
} from "@knowledge/parsers";
import {
  type NativeParserRequest,
  type NativeParserResponse,
  encodeNativeParserFailure,
  nativeParserOutputBytes,
} from "./native-parser-protocol";

// A single immutable request per process. No providers, credentials or document filesystem IO.
process.once("message", async (request: NativeParserRequest) => {
  const started = performance.now();
  let response: NativeParserResponse;
  try {
    const parser =
      request.kind === "native-html"
        ? createNativeHtmlParser(request.options)
        : request.kind === "native-markdown"
          ? createNativeMarkdownParser(request.options)
          : createNativeStructuredDataParser(request.options);
    const artifact = await parser.parse(request.input);
    const outputBytes = Buffer.byteLength(JSON.stringify(artifact));
    if (outputBytes > nativeParserOutputBytes)
      throw new Error("Native parser output exceeds 32 MiB");
    response = {
      ok: true,
      artifact: {
        ...artifact,
        metadata: {
          ...artifact.metadata,
          parserExecution: {
            isolation: "child-process",
            inputBytes: request.input.body.byteLength,
            outputBytes,
            wallMs: performance.now() - started,
            peakRssKiB: process.resourceUsage().maxRSS,
          },
        },
      },
    };
  } catch (error) {
    response = encodeNativeParserFailure(error);
  }
  process.send?.(response, () => process.disconnect());
});
