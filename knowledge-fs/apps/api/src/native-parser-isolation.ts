import { type ChildProcess, fork } from "node:child_process";
import {
  type ParserAdapter,
  ProviderInputError,
  ProviderResponseError,
  ProviderUnsupportedFileTypeError,
} from "@knowledge/parsers";
import {
  type IsolatedProcessOptions,
  createIsolatedProcessExecutor,
} from "./isolated-process-executor";
import {
  type NativeParserRequest,
  type SerializableNativeParserOptions,
  decodeNativeParserResponse,
} from "./native-parser-protocol";

function spawnNativeParser(): ChildProcess {
  const compiled = import.meta.url.endsWith(".mjs");
  return fork(
    new URL(compiled ? "./native-parser-worker.mjs" : "./native-parser-worker.ts", import.meta.url),
    [],
    {
      execArgv: ["--max-old-space-size=256", ...(compiled ? [] : ["--import", "tsx"])],
      // Native parsers need neither provider credentials nor arbitrary NODE_OPTIONS hooks.
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT },
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
}

export function createNativeParserIsolation(
  options: Omit<IsolatedProcessOptions, "spawn"> & { readonly spawn?: () => ChildProcess } = {},
) {
  const executor = createIsolatedProcessExecutor<NativeParserRequest, unknown>({
    maxRssBytes: 512 * 1024 * 1024,
    ...options,
    spawn: options.spawn ?? spawnNativeParser,
  });
  return {
    wrap(parser: ParserAdapter, options: SerializableNativeParserOptions): ParserAdapter {
      if (parser.kind === "unstructured")
        throw new Error("Native isolation cannot wrap a remote parser");
      if (Object.values(options).some((value) => typeof value === "function"))
        throw new Error(
          "Native isolation options must be serializable (callbacks are not supported)",
        );
      const kind = parser.kind;
      const frozenOptions = Object.freeze({ ...options });
      return {
        ...parser,
        async parse(input) {
          const { signal, ...serializedInput } = input;
          const payload = await executor.execute(
            { input: serializedInput, kind, options: frozenOptions },
            input.body.byteLength,
            signal,
          );
          const response = decodeNativeParserResponse(payload);
          if (!response)
            throw new ProviderResponseError("Native parser worker returned an invalid response");
          if (response.ok) return response.artifact;
          throw response.errorCode === "document_parser_unsupported_type"
            ? new ProviderUnsupportedFileTypeError(response.message)
            : response.errorCode === "provider_input"
              ? new ProviderInputError(response.message)
              : new ProviderResponseError(response.message);
        },
      };
    },
  };
}
