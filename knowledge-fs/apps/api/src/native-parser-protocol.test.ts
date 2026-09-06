import { ProviderInputError, ProviderUnsupportedFileTypeError } from "@knowledge/parsers";
import { describe, expect, it } from "vitest";
import { decodeNativeParserResponse, encodeNativeParserFailure } from "./native-parser-protocol";

describe("native parser failure protocol", () => {
  it.each([
    [new ProviderInputError("invalid source"), "provider_input"],
    [new ProviderUnsupportedFileTypeError("unsupported"), "document_parser_unsupported_type"],
    [new Error("unexpected implementation failure"), "provider_response_invalid"],
    [null, "provider_response_invalid"],
  ])("preserves only known failure classifications %#", (error, errorCode) => {
    const result = encodeNativeParserFailure(error);
    expect(result).toMatchObject({ ok: false, errorCode });
    expect(decodeNativeParserResponse(result)).toEqual(result);
  });
  it("bounds error text and rejects unrecognized failure codes", () => {
    expect(encodeNativeParserFailure(new Error("x".repeat(2000))).message).toHaveLength(1024);
    expect(
      decodeNativeParserResponse({ ok: false, message: "x", errorCode: "unknown" }),
    ).toBeUndefined();
  });
});
