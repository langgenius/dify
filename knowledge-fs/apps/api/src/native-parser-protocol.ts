import { type ParseArtifact, ParseArtifactSchema } from "@knowledge/core";
import type {
  ParseDocumentInput,
  ParserKind,
  StructuredDataParserOptions,
} from "@knowledge/parsers";

export interface NativeParserRequest {
  readonly input: Omit<ParseDocumentInput, "signal">;
  readonly kind: Exclude<ParserKind, "unstructured">;
  readonly options: SerializableNativeParserOptions;
}

export type SerializableNativeParserOptions = Omit<
  StructuredDataParserOptions,
  "generateId" | "now"
>;

export type NativeParserResponse =
  | { readonly ok: true; readonly artifact: ParseArtifact }
  | {
      readonly ok: false;
      readonly message: string;
      readonly errorCode:
        | "provider_input"
        | "document_parser_unsupported_type"
        | "provider_response_invalid";
    };

export function encodeNativeParserFailure(
  error: unknown,
): Extract<NativeParserResponse, { ok: false }> {
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return {
    ok: false,
    message:
      error instanceof Error ? error.message.slice(0, 1024) : "Native document parsing failed",
    errorCode:
      code === "provider_input" || code === "document_parser_unsupported_type"
        ? code
        : "provider_response_invalid",
  };
}

export function decodeNativeParserResponse(value: unknown): NativeParserResponse | undefined {
  if (typeof value !== "object" || value === null || !("ok" in value)) return undefined;
  if (value.ok === true && "artifact" in value) {
    const parsed = ParseArtifactSchema.safeParse(value.artifact);
    return parsed.success ? { ok: true, artifact: parsed.data } : undefined;
  }
  if (
    value.ok === false &&
    "message" in value &&
    typeof value.message === "string" &&
    value.message.length <= 1024 &&
    "errorCode" in value &&
    (value.errorCode === "provider_input" ||
      value.errorCode === "document_parser_unsupported_type" ||
      value.errorCode === "provider_response_invalid")
  ) {
    return { ok: false, message: value.message, errorCode: value.errorCode };
  }
  return undefined;
}

// Serialized output is bounded independently from the child's V8 heap ceiling.
export const nativeParserOutputBytes = 32 * 1024 * 1024;
