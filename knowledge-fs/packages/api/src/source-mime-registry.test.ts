import { describe, expect, it } from "vitest";
import { mimeTypeForFilename } from "./source-handlers";

describe("source file MIME inference shares the upload registry", () => {
  it.each([
    ["source.JSONL", "application/x-ndjson"],
    [" mail.eml ", "message/rfc822"],
    ["legacy.doc", "application/msword"],
    ["deck.ppt", "application/vnd.ms-powerpoint"],
    ["caption.vtt", "text/vtt"],
    ["settings.properties", "text/x-java-properties"],
    ["data.unknown", "application/octet-stream"],
    ["README", "application/octet-stream"],
  ])("infers %s without widening upload types", (filename, expected) => {
    expect(mimeTypeForFilename(filename)).toBe(expected);
  });
});
