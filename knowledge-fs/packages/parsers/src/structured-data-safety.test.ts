import { describe, expect, it } from "vitest";

import {
  createNativeHtmlParser,
  createNativeMarkdownParser,
  createNativeStructuredDataParser,
  createParserRouter,
} from "./index";

const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
function input(text: string, extension = "json") {
  return {
    body: new TextEncoder().encode(text),
    documentAssetId,
    filename: `data.${extension}`,
    mimeType: extension === "csv" ? "text/csv" : `application/${extension}`,
    version: 1,
  };
}

describe("structured document fidelity and resource safety", () => {
  it("preserves duplicate CSV columns without overwriting either value", async () => {
    const artifact = await createNativeStructuredDataParser().parse(
      input("name,name\nleft,right", "csv"),
    );
    expect(artifact.elements[0]?.text).toBe("name: left | name_2: right");
  });

  it("does not collide generated duplicate names with original CSV column names", async () => {
    const artifact = await createNativeStructuredDataParser().parse(
      input("name,name,name_2\nleft,middle,right", "csv"),
    );
    expect(artifact.elements[0]?.text).toContain("left");
    expect(artifact.elements[0]?.text).toContain("middle");
    expect(artifact.elements[0]?.text).toContain("right");
    expect(new Set(artifact.elements[0]?.metadata.columns as string[]).size).toBe(3);
  });

  it("preserves integer and decimal JSON numeric lexemes", async () => {
    const artifact = await createNativeStructuredDataParser().parse(
      input('{"id":9007199254740993,"decimal":0.1234567890123456789,"large":1e400}'),
    );
    expect(artifact.elements[0]?.text).toContain("9007199254740993");
    expect(artifact.elements[0]?.text).toContain("0.1234567890123456789");
    expect(artifact.elements[0]?.text).toContain("1e400");
  });

  it("preserves nested and tabular JSON numbers", async () => {
    const artifact = await createNativeStructuredDataParser().parse(
      input('[{"id":9007199254740993,"nested":{"amount":1e400}}]'),
    );
    expect(artifact.elements[0]?.text).toBe('id: 9007199254740993 | nested: {"amount":1e400}');
  });

  it("preserves scalar, null and array JSONL records in source order", async () => {
    const artifact = await createNativeStructuredDataParser().parse(
      input('42\ntrue\n"abc"\nnull\n[1,2]', "jsonl"),
    );
    const text = artifact.elements.map((element) => element.text).join("\n");
    expect(text).toContain("42");
    expect(text).toContain("true");
    expect(text).toContain('"abc"');
    expect(text).toContain("null");
    expect(text).toContain("[1,2]");
  });

  it("retains XML attributes and leading-zero identifiers", async () => {
    const artifact = await createNativeStructuredDataParser().parse(
      input('<person id="A1" status="active"><code>00123</code></person>', "xml"),
    );
    expect(artifact.elements[0]?.text).toContain("A1");
    expect(artifact.elements[0]?.text).toContain("active");
    expect(artifact.elements[0]?.text).toContain("00123");
  });

  it("keeps sparse records sparse without losing their field labels", async () => {
    const source = Array.from({ length: 300 }, (_, index) => ({ [`field${index}`]: index }));
    const artifact = await createNativeStructuredDataParser().parse(input(JSON.stringify(source)));
    const text = artifact.elements.map((element) => element.text).join("\n");
    expect(text.length).toBeLessThan(20_000);
    expect(text).toContain("field0: 0");
    expect(text).toContain("field299: 299");
  });

  it("rejects excessive JSON nesting as a non-retryable input error before recursive parsing", async () => {
    await expect(
      createNativeStructuredDataParser().parse(input(`${"[".repeat(500)}1${"]".repeat(500)}`)),
    ).rejects.toMatchObject({ code: "provider_input", retryable: false });
  });

  it("does not parse an already-cancelled native request", async () => {
    const reason = new Error("cancelled by caller");
    await expect(
      createNativeStructuredDataParser().parse({
        ...input("{}"),
        signal: AbortSignal.abort(reason),
      }),
    ).rejects.toBe(reason);
  });

  it.each([createNativeMarkdownParser, createNativeHtmlParser])(
    "cancels native markup before inspecting an over-limit input",
    async (createParser) => {
      const reason = new Error("cancelled before parsing");
      await expect(
        createParser({ maxInputBytes: 1 }).parse({
          ...input("long input", "md"),
          signal: AbortSignal.abort(reason),
        }),
      ).rejects.toBe(reason);
    },
  );

  it("keeps structured files on their parser instead of using an incompatible size fallback", async () => {
    let remoteCalls = 0;
    const router = createParserRouter({
      html: createNativeHtmlParser(),
      markdown: createNativeMarkdownParser(),
      maxNativeInputBytes: 8,
      structured: createNativeStructuredDataParser({ maxInputBytes: 128 }),
      unstructured: {
        kind: "unstructured",
        parse: async () => {
          remoteCalls += 1;
          throw new Error("incompatible remote parser");
        },
      },
    });
    const artifact = await router.parse(input('{"value":123}'));
    expect(artifact.metadata.routedParser).toBe("native-structured");
    expect(remoteCalls).toBe(0);
  });

  it("preserves the ordinary homogeneous table representation", async () => {
    const artifact = await createNativeStructuredDataParser().parse(
      input('[{"name":"A","value":2},{"name":"B","value":3}]'),
    );
    expect(artifact.elements[0]?.text).toBe("name: A | value: 2\nname: B | value: 3");
  });

  it("keeps duplicate Markdown headers distinct even when their suffix already exists", async () => {
    const artifact = await createNativeMarkdownParser().parse(
      input("| name | name | name_2 |\n| --- | --- | --- |\n| left | middle | right |", "md"),
    );
    expect(artifact.elements[0]?.text).toBe("name: left | name_3: middle | name_2: right");
  });

  it("bounds native Markdown table width before constructing projected rows", async () => {
    const columns = Array.from({ length: 4097 }, (_, index) => `c${index}`);
    const source = `| ${columns.join(" | ")} |\n| ${columns.map(() => "---").join(" | ")} |\n| ${columns.map(() => "x").join(" | ")} |`;
    await expect(createNativeMarkdownParser().parse(input(source, "md"))).rejects.toMatchObject({
      code: "provider_input",
      retryable: false,
    });
  });

  it("preserves prototype-shaped CSV column names as ordinary own fields", async () => {
    const artifact = await createNativeStructuredDataParser().parse(
      input("__proto__,constructor,prototype\nleft,middle,right", "csv"),
    );
    expect(artifact.elements[0]?.text).toBe(
      "__proto__: left | constructor: middle | prototype: right",
    );
  });

  it("does not manufacture inherited values for missing JSON record columns", async () => {
    const artifact = await createNativeStructuredDataParser().parse(
      input('[{"constructor":"real","__proto__":"own"},{"value":"other"}]'),
    );
    expect(artifact.elements[0]?.text).toBe(
      "constructor: real | __proto__: own | value: \nconstructor:  | __proto__:  | value: other",
    );
  });

  it("retains CSV headers when the document has no data rows", async () => {
    const artifact = await createNativeStructuredDataParser().parse(input("name,score", "csv"));
    expect(artifact.elements[0]?.text).toBe("name | score");
    expect(artifact.elements[0]?.metadata.columns).toEqual(["name", "score"]);
  });

  it("rejects overwide CSV headers before naming duplicates or reading data rows", async () => {
    const result = await createNativeStructuredDataParser()
      .parse(input(Array(4097).fill("name").join(","), "csv"))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(result).toMatchObject({ code: "provider_input", retryable: false });
  });
});
