import { describe, expect, it } from "vitest";
import { createArchiveMediaReportCollector } from "./parse-coverage";

describe("bounded parse coverage reports", () => {
  it("bounds diagnostic references and explicitly reports truncation", () => {
    const report = createArchiveMediaReportCollector(true);
    report.skip("x".repeat(1025), "unsupported-media-format");
    for (let index = 0; index < 4096; index += 1)
      report.skip(`word/media/${index}.svg`, "unsupported-media-format");
    const metadata = report.metadata();
    expect(metadata.archiveMediaReport.skippedResources).toHaveLength(4096);
    expect(metadata.archiveMediaReport.skippedResources[0]?.archivePath).toHaveLength(1024);
    expect(metadata.archiveMediaReport.omittedReferences).toBe(1);
    expect(metadata.parseCoverage.media.reasons).toContain("resource-reference-truncated");
  });
});
