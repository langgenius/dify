export interface ParseCoveragePart {
  readonly status: "complete" | "partial" | "unknown" | "not-requested";
  readonly reasons: readonly string[];
}

/** Diagnostic references are bounded independently from decoded images and never inline bytes. */
export function createArchiveMediaReportCollector(requiresImages: boolean | undefined) {
  const skippedResources: { archivePath: string; reason: string }[] = [];
  const reasons = new Set<string>();
  let omittedReferences = 0;
  let observedResources = 0;
  const maxDiagnosticReferences = 4096;
  return {
    observe() {
      observedResources += 1;
    },
    skip(archivePath: string, reason: string) {
      reasons.add(reason);
      if (skippedResources.length < maxDiagnosticReferences) {
        skippedResources.push({ archivePath: archivePath.slice(0, 1024), reason });
        if (archivePath.length > 1024) reasons.add("resource-reference-truncated");
      } else omittedReferences += 1;
    },
    metadata() {
      const unknown = { reasons: ["provider-coverage-not-reported"], status: "unknown" } as const;
      const media: ParseCoveragePart =
        requiresImages === false
          ? { reasons: ["image-extraction-disabled"], status: "not-requested" }
          : reasons.size > 0
            ? { reasons: [...reasons].sort(), status: "partial" }
            : unknown;
      return {
        archiveMediaReport: { observedResources, omittedReferences, skippedResources },
        parseCoverage: { media, tables: unknown, text: unknown },
      };
    },
  };
}
