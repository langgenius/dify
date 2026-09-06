import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  createNativeHtmlParser,
  createNativeMarkdownParser,
  createNativeStructuredDataParser,
  createUnstructuredParserClient,
} from "./index";

const input = (body: Uint8Array | string, filename = "fixture.md", mimeType = "text/markdown") => ({
  body: typeof body === "string" ? new TextEncoder().encode(body) : body,
  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
  filename,
  mimeType,
  version: 1,
});

describe("text document decoding contracts", () => {
  it.each([
    ["x.json", "{"],
    ["x.csv", 'a,b\n"unterminated'],
    ["x.jsonl", "null\n{"],
  ])(
    "classifies malformed %s as terminal parser input rather than generic compilation failure",
    async (filename, body) => {
      await expect(
        createNativeStructuredDataParser().parse(input(body, filename)),
      ).rejects.toMatchObject({ code: "provider_input", retryable: false });
    },
  );
  it("classifies native element and row limits as terminal input failures", async () => {
    await expect(
      createNativeMarkdownParser({ maxElements: 1 }).parse(input("# heading\n\nbody")),
    ).rejects.toMatchObject({ code: "provider_input" });
    await expect(
      createNativeStructuredDataParser({ maxRows: 1 }).parse(input("a\n1\n2", "x.csv")),
    ).rejects.toMatchObject({ code: "provider_input" });
  });
  it.each(["utf16le", "utf16be"])(
    "decodes BOM-marked %s without indexing NULs",
    async (encoding) => {
      const bytes = Buffer.from("\ufeff# 中文\n\nhello", "utf16le");
      if (encoding === "utf16be") bytes.swap16();
      const artifact = await createNativeMarkdownParser().parse(input(bytes));
      expect(artifact.elements.map((element) => element.text)).toEqual(["中文", "hello"]);
      expect(artifact.metadata.textEncoding).toBe(encoding === "utf16le" ? "utf-16le" : "utf-16be");
    },
  );
  it.each([
    new Uint8Array([0xc3, 0x28]),
    new Uint8Array([0xff, 0xfe, 0x00]),
    new Uint8Array([0xfe, 0xff, 0xd8, 0x00]),
    new Uint8Array([0xff, 0xfe, 0x00, 0x00]),
  ])("rejects malformed or unsupported text encoding %#", async (bytes) => {
    await expect(createNativeMarkdownParser().parse(input(bytes))).rejects.toMatchObject({
      code: "provider_input",
      retryable: false,
    });
  });
  it("uses strict decoding in HTML and structured text", async () => {
    const bytes = new Uint8Array([0xc3, 0x28]);
    await expect(
      createNativeHtmlParser().parse(input(bytes, "x.html", "text/html")),
    ).rejects.toMatchObject({ code: "provider_input" });
    await expect(
      createNativeStructuredDataParser().parse(input(bytes, "x.json", "application/json")),
    ).rejects.toMatchObject({ code: "provider_input" });
  });
  it("decodes properties escapes, continuations and separators without indexing comments", async () => {
    const artifact = await createNativeMarkdownParser().parse(
      input(
        "# comment\n! also comment\nhello\\ world = \\u4e2d\\u6587\nlong: first\\\n  second\nempty\n__proto__=safe",
        "x.properties",
        "text/plain",
      ),
    );
    expect(artifact.elements.map((element) => element.text)).toEqual([
      "hello world = 中文",
      "long = firstsecond",
      "empty = ",
      "__proto__ = safe",
    ]);
    expect(artifact.elements[0]?.metadata).toMatchObject({
      propertyKey: "hello world",
      sourceLine: 3,
      format: "properties",
    });
  });
  it("rejects malformed property Unicode escapes", async () => {
    await expect(
      createNativeMarkdownParser().parse(input("key=\\uXYZW", "x.properties")),
    ).rejects.toMatchObject({ code: "provider_input" });
  });
  it("preserves escaped separators, whitespace, Unicode surrogate pairs and terminal continuation", async () => {
    const artifact = await createNativeMarkdownParser().parse(
      input("  a\\:b\\=c : \\t\\n\\r\\f\\q\\\\\nemoji=\\uD83D\\uDE00\nlast=tail\\", "x.properties"),
    );
    expect(artifact.elements.map((element) => element.metadata.propertyValue)).toEqual([
      "\t\n\r\fq\\",
      "😀",
      "tail",
    ]);
    expect(artifact.elements[0]?.metadata.propertyKey).toBe("a:b=c");
  });
  it.each(["key=\\uD800", "key=\\uDC00"])(
    "rejects unpaired property surrogate %s",
    async (body) => {
      await expect(
        createNativeMarkdownParser().parse(input(body, "x.properties")),
      ).rejects.toMatchObject({ code: "provider_input" });
    },
  );
  it.each(["properties", "vtt"])(
    "bounds %s elements before accumulating the complete file",
    async (extension) => {
      const body =
        extension === "properties"
          ? "first=one\nsecond=two"
          : "WEBVTT\n\n00:00.000 --> 00:01.000\na\n\n00:01.000 --> 00:02.000\nb";
      await expect(
        createNativeMarkdownParser({ maxElements: 1 }).parse(input(body, `x.${extension}`)),
      ).rejects.toMatchObject({ code: "provider_input" });
    },
  );
  it("decodes UTF-8 BOM and rejects unmarked binary NUL text", async () => {
    const artifact = await createNativeMarkdownParser().parse(input("\ufeffhello"));
    expect(artifact.metadata.textEncoding).toBe("utf-8");
    expect(artifact.elements[0]?.text).toBe("hello");
    await expect(createNativeMarkdownParser().parse(input("h\0i\0"))).rejects.toMatchObject({
      code: "provider_input",
    });
    await expect(
      createNativeMarkdownParser().parse(input(new Uint8Array([0, 0, 0xfe, 0xff]))),
    ).rejects.toMatchObject({ code: "provider_input" });
  });
  it("keeps VTT hour timings, multiline payload and empty cues", async () => {
    const artifact = await createNativeMarkdownParser().parse(
      input(
        "WEBVTT title\r\n\r\nREGION\r\nid:region1\r\n\r\n01:01:01.100 --> 01:01:02.500\r\na\r\nb\r\n\r\n01:01:03.000 --> 01:01:04.000\r\n",
        "x.vtt",
      ),
    );
    expect(artifact.elements.map((element) => element.text)).toEqual(["a\nb", ""]);
    expect(artifact.elements[0]?.metadata.startTimeMs).toBe(3661100);
  });
  it("rejects unsafe VTT hour magnitudes and malformed cue timing lines", async () => {
    for (const body of [
      "WEBVTT\n\n999999999999999:01:01.000 --> 999999999999999:01:02.000\na",
      "WEBVTT\n\nidentifier\nnot timings\na",
    ]) {
      await expect(createNativeMarkdownParser().parse(input(body, "x.vtt"))).rejects.toMatchObject({
        code: "provider_input",
      });
    }
  });
  it.each(["", " ", "x".repeat(257)])("rejects invalid backend revision %#", (backendRevision) => {
    expect(() =>
      createUnstructuredParserClient({ endpoint: "https://parser.test", backendRevision }),
    ).toThrow("backendRevision");
  });
  it("retains VTT cues and timings while excluding control blocks", async () => {
    const artifact = await createNativeMarkdownParser().parse(
      input(
        "WEBVTT\n\nNOTE ignore\nnot speech\n\nSTYLE\n::cue { color: red; }\n\ncue-1\n00:01.000 --> 00:02.500 align:start\n<v Alice>Hello <b>world</b> &amp; team\n\n00:02.500 --> 00:04.000\nSecond line",
        "x.vtt",
        "text/vtt",
      ),
    );
    expect(artifact.elements.map((element) => element.text)).toEqual([
      "Hello world & team",
      "Second line",
    ]);
    expect(artifact.elements[0]?.metadata).toMatchObject({
      cueId: "cue-1",
      startTimeMs: 1000,
      endTimeMs: 2500,
      settings: "align:start",
      format: "vtt",
    });
  });
  it.each([
    "no header",
    "WEBVTT\n\n00:03.000 --> 00:02.000\nbackwards",
    "WEBVTT\n\n00:90.000 --> 00:91.000\nbad",
    "WEBVTT\n\n00:01.000 --> 00:02.000\nhello\n00:03.000 --> 00:04.000",
  ])("rejects malformed VTT without silently dropping content %#", async (body) => {
    await expect(createNativeMarkdownParser().parse(input(body, "x.vtt"))).rejects.toMatchObject({
      code: "provider_input",
    });
  });
  it("versions remote policy and artifacts by backend semantic revision", async () => {
    const remote = (backendRevision: string) =>
      createUnstructuredParserClient({
        endpoint: "https://parser.test",
        backendRevision,
        fetch: async () => Response.json([{ type: "NarrativeText", text: "hello", metadata: {} }]),
      });
    const source = input("hello", "x.txt", "text/plain");
    const first = remote("pinned-a");
    const second = remote("pinned-b");
    expect(first.policyFingerprint?.(source)).not.toBe(second.policyFingerprint?.(source));
    const [a, b] = await Promise.all([first.parse(source), second.parse(source)]);
    expect(a.artifactHash).not.toBe(b.artifactHash);
    expect(a.metadata.backendRevision).toBe("pinned-a");
  });
});
