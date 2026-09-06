import { describe, expect, it } from "vitest";

import { createNativeHtmlParser, createNativeMarkdownParser } from "./index";

const input = (body: string, extension: "html" | "md" | "mdx" = "md") => ({
  body: new TextEncoder().encode(body),
  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
  filename: `fixture.${extension}`,
  mimeType: extension === "html" ? "text/html" : "text/markdown",
  version: 1,
});

describe("native markup content fidelity", () => {
  it("retains nested blockquotes and their images in section order", async () => {
    const artifact = await createNativeMarkdownParser().parse(
      input(
        "# Rules\n\n> Quoted policy\n>\n> > Nested policy\n>\n> ![Evidence](proof.png)\n\nFinal policy",
      ),
    );
    expect(artifact.elements.map((element) => element.text)).toEqual([
      "Rules",
      "Quoted policy",
      "Nested policy",
      "Evidence",
      "Final policy",
    ]);
    expect(artifact.elements.every((element) => element.sectionPath[0] === "Rules")).toBe(true);
  });

  it.each(["md", "mdx"] as const)(
    "keeps static HTML text in %s without indexing script/style bodies",
    async (extension) => {
      const artifact = await createNativeMarkdownParser().parse(
        input(
          "<Callout>Critical <strong>policy</strong><script>secretScript()</script><style>secretStyle</style></Callout>",
          extension,
        ),
      );
      expect(artifact.elements.map((element) => element.text).join(" ")).toBe("Critical policy");
    },
  );

  it("keeps text on both sides of Markdown images in source order without duplicating image syntax", async () => {
    const artifact = await createNativeMarkdownParser().parse(
      input(
        "Before ![Diagram](a.png) after ![Photo](b.png) ending.\n\n![First](c.png) retained suffix.",
      ),
    );
    expect(artifact.elements.map((element) => [element.type, element.text])).toEqual([
      ["paragraph", "Before"],
      ["image", "Diagram"],
      ["paragraph", "after"],
      ["image", "Photo"],
      ["paragraph", "ending."],
      ["image", "First"],
      ["paragraph", "retained suffix."],
    ]);
  });

  it("retains inline HTML text and excludes embedded executable content in Markdown paragraphs", async () => {
    const artifact = await createNativeMarkdownParser().parse(
      input("Before <span>important</span> <script>hidden()</script> after."),
    );
    expect(artifact.elements.map((element) => element.text)).toEqual(["Before important after."]);
  });

  it("preserves each placement caption when the same Markdown image URI is reused", async () => {
    const artifact = await createNativeMarkdownParser().parse(
      input('![First](same.png "One") ![Second](same.png "Two")'),
    );
    expect(
      artifact.elements.map((element) => [
        element.text,
        element.metadata.caption,
        element.metadata.title,
      ]),
    ).toEqual([
      ["First", "First", "One"],
      ["Second", "Second", "Two"],
    ]);
  });

  it("keeps images nested in Markdown headings and tables", async () => {
    const artifact = await createNativeMarkdownParser().parse(
      input(
        "# Heading ![Badge](badge.png)\n\n| Name | Evidence |\n| --- | --- |\n| Ada | ![Chart](chart.png) |",
      ),
    );
    expect(
      artifact.elements
        .filter((element) => element.type === "image")
        .map((element) => element.text),
    ).toEqual(["Badge", "Chart"]);
    expect(artifact.elements[0]).toMatchObject({
      sectionPath: ["Heading"],
      text: "Heading",
      type: "heading",
    });
  });

  it("retains HTML heading/table images without duplicating normal text", async () => {
    const artifact = await createNativeHtmlParser().parse(
      input(
        '<h1>Heading<img src="badge.png" alt="Badge"></h1><table><tr><th>Name</th><th>Evidence</th></tr><tr><td>Ada</td><td><img src="chart.png" alt="Chart"></td></tr></table>',
        "html",
      ),
    );
    expect(artifact.elements.map((element) => element.type)).toEqual([
      "heading",
      "image",
      "table",
      "image",
    ]);
    expect(
      artifact.elements
        .filter((element) => element.type === "image")
        .map((element) => element.text),
    ).toEqual(["Badge", "Chart"]);
  });

  it("does not extract images hidden inside excluded HTML subtrees", async () => {
    const artifact = await createNativeHtmlParser().parse(
      input(
        '<h1>Heading<noscript><img src="hidden.png" alt="hidden"></noscript></h1><table><tr><td>Kept<noscript><img src="also-hidden.png"></noscript></td></tr></table>',
        "html",
      ),
    );
    expect(artifact.elements.map((element) => element.type)).toEqual(["heading", "table"]);
    expect(artifact.elements.map((element) => element.text).join(" ")).not.toContain("hidden");
  });

  it("rejects excessive HTML node counts even when the tree is shallow", async () => {
    await expect(
      createNativeHtmlParser().parse(
        input(`<div>${"<span></span>".repeat(250_001)}</div>`, "html"),
      ),
    ).rejects.toMatchObject({
      code: "provider_input",
      name: "ParserResourceLimitError",
      retryable: false,
    });
  });

  it("extracts images inside Markdown lists and links without losing surrounding list content", async () => {
    const artifact = await createNativeMarkdownParser().parse(
      input("- Before [![Linked](a.png)](https://example.test) after\n- Last item"),
    );
    expect(artifact.elements.map((element) => [element.type, element.text])).toEqual([
      ["list", "Before"],
      ["image", "Linked"],
      ["list", "after\nLast item"],
    ]);
  });

  it("retains direct container text and nested inline images without duplicate text", async () => {
    const artifact = await createNativeHtmlParser().parse(
      input(
        '<h1>Guide</h1><div>Bare <em>text</em><p>Before <a><img src="a.png" alt="Figure"></a> after</p>Trailing text</div>',
        "html",
      ),
    );
    expect(artifact.elements.map((element) => [element.type, element.text])).toEqual([
      ["heading", "Guide"],
      ["paragraph", "Bare text"],
      ["paragraph", "Before"],
      ["image", "Figure"],
      ["paragraph", "after"],
      ["paragraph", "Trailing text"],
    ]);
    expect(artifact.elements.every((element) => element.sectionPath[0] === "Guide")).toBe(true);
  });

  it("retains list images, inline spacing, and line breaks without indexing scripts", async () => {
    const artifact = await createNativeHtmlParser().parse(
      input(
        '<ul><li>Before<img src="a.png" alt="Figure">after<script>hidden()</script></li><li>Last<br>line</li></ul>',
        "html",
      ),
    );
    expect(artifact.elements.map((element) => [element.type, element.text])).toEqual([
      ["list", "Before"],
      ["image", "Figure"],
      ["list", "after\nLast\nline"],
    ]);
  });

  it("preserves all figure images and captions instead of selecting only the first image", async () => {
    const artifact = await createNativeHtmlParser().parse(
      input(
        '<figure><img src="a.png"><img src="b.png"><figcaption>Shared caption</figcaption></figure>',
        "html",
      ),
    );
    expect(artifact.elements.map((element) => [element.type, element.text])).toEqual([
      ["image", "Shared caption"],
      ["image", "Shared caption"],
    ]);
  });

  it("rejects overly deep HTML with a non-retryable resource error instead of overflowing the stack", async () => {
    await expect(
      createNativeHtmlParser().parse(
        input(`${"<div>".repeat(5_000)}text${"</div>".repeat(5_000)}`, "html"),
      ),
    ).rejects.toMatchObject({
      code: "provider_input",
      name: "ParserResourceLimitError",
      retryable: false,
    });
  });
});
