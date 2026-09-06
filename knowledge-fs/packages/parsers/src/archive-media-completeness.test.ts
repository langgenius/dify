import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createUnstructuredParserClient } from "./index";

const parser = () =>
  createUnstructuredParserClient({
    endpoint: "https://parser.test",
    fetch: async () =>
      Response.json([{ type: "NarrativeText", text: "Readable body", metadata: {} }]),
  });
const input = (entries: Record<string, Uint8Array>, requiresImages?: boolean) => ({
  body: zipSync(entries),
  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
  filename: "x.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  parserHints: requiresImages === undefined ? {} : { requiresImages },
  version: 1,
});

describe("archive media completeness", () => {
  it("does not coalesce or reuse legacy-auto image output for explicitly disabled media", async () => {
    const remote = parser();
    const entries = { "word/media/photo.png": new Uint8Array([1, 2, 3]) };
    const automatic = input(entries);
    const disabled = { ...automatic, parserHints: { requiresImages: false } };
    expect(remote.policyFingerprint?.(automatic)).not.toBe(remote.policyFingerprint?.(disabled));
    const [withImages, withoutImages] = await Promise.all([
      remote.parse(automatic),
      remote.parse(disabled),
    ]);
    expect(withImages.elements.some((element) => element.type === "image")).toBe(true);
    expect(withoutImages.elements.some((element) => element.type === "image")).toBe(false);
    expect(withImages.artifactHash).not.toBe(withoutImages.artifactHash);
  });
  it("reports unsupported media by source path without silently claiming complete", async () => {
    const artifact = await parser().parse(
      input({ "word/media/vector.svg": new TextEncoder().encode("<svg/>") }, true),
    );
    expect(artifact.elements.map((element) => element.text)).toEqual(["Readable body"]);
    expect(artifact.metadata.parseCoverage).toMatchObject({
      media: { status: "partial", reasons: ["unsupported-media-format"] },
    });
    expect(artifact.metadata.archiveMediaReport).toMatchObject({
      skippedResources: [
        { archivePath: "word/media/vector.svg", reason: "unsupported-media-format" },
      ],
    });
  });
  it("honors disabled image extraction without materializing archive images", async () => {
    const artifact = await parser().parse(
      input({ "word/media/photo.png": new Uint8Array([1, 2, 3]) }, false),
    );
    expect(artifact.elements.some((element) => element.type === "image")).toBe(false);
    expect(artifact.metadata.parseCoverage).toMatchObject({ media: { status: "not-requested" } });
  });
  it("records Office charts and drawing definitions whose visuals cannot be extracted", async () => {
    const artifact = await parser().parse(
      input({ "word/charts/chart1.xml": new TextEncoder().encode("<chart/>") }),
    );
    expect(artifact.metadata.parseCoverage).toMatchObject({
      media: { status: "partial", reasons: ["office-visual-structure-not-rendered"] },
    });
  });
  it("reports oversized image omission and retains its archive reference", async () => {
    const artifact = await parser().parse(
      input({ "word/media/photo.png": new Uint8Array(10 * 1024 * 1024 + 1) }),
    );
    expect(artifact.metadata.archiveMediaReport).toMatchObject({
      skippedResources: [{ archivePath: "word/media/photo.png", reason: "media-byte-budget" }],
    });
  });
});
