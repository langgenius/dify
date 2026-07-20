export interface DocumentHealthAsset {
  readonly filename: string;
  readonly parserStatus: "failed" | "parsed" | "pending";
  readonly sizeBytes: number;
}

export interface DocumentHealthArtifact {
  readonly elements: readonly DocumentHealthElement[];
  readonly parser: "native-html" | "native-markdown" | "native-structured" | "unstructured";
}

export interface DocumentHealthElement {
  readonly id: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sectionPath: readonly string[];
  readonly text?: string | undefined;
  readonly type: string;
}

export interface CreateDocumentHealthReportInput {
  readonly artifact?: DocumentHealthArtifact | undefined;
  readonly asset: DocumentHealthAsset;
  readonly maxRisks?: number | undefined;
  readonly nodeCount: number;
}

export interface DocumentHealthReport {
  readonly documentName: string;
  readonly elementCount: number;
  readonly nodeCount: number;
  readonly parser: string;
  readonly parserStatus: DocumentHealthAsset["parserStatus"];
  readonly publishReadiness: "blocked" | "ready" | "review";
  readonly qualityRisks: readonly string[];
  readonly sizeLabel: string;
}

export function createDocumentHealthReport({
  artifact,
  asset,
  maxRisks = 5,
  nodeCount,
}: CreateDocumentHealthReportInput): DocumentHealthReport {
  if (!Number.isInteger(maxRisks) || maxRisks < 1) {
    throw new Error("Document health maxRisks must be at least 1");
  }

  if (!Number.isInteger(nodeCount) || nodeCount < 0) {
    throw new Error("Document health nodeCount must be non-negative");
  }

  const risks: string[] = [];
  if (asset.parserStatus === "failed") {
    risks.push("Parser failed");
  }

  const elementCount = artifact?.elements.length ?? 0;
  if (asset.parserStatus === "parsed" && !artifact) {
    risks.push("Parse artifact missing");
  }

  if (artifact && elementCount === 0) {
    risks.push("No parse elements");
  }

  if (artifact?.elements.every((element) => !element.text?.trim())) {
    risks.push("No text extracted");
  }

  if (nodeCount === 0 && asset.parserStatus === "parsed") {
    risks.push("No knowledge nodes");
  }

  const boundedRisks = risks.slice(0, maxRisks);

  return {
    documentName: asset.filename,
    elementCount,
    nodeCount,
    parser: artifact?.parser ?? "not parsed",
    parserStatus: asset.parserStatus,
    publishReadiness: getPublishReadiness(asset.parserStatus, boundedRisks),
    qualityRisks: boundedRisks,
    sizeLabel: formatBytes(asset.sizeBytes),
  };
}

function getPublishReadiness(
  parserStatus: DocumentHealthAsset["parserStatus"],
  qualityRisks: readonly string[],
): DocumentHealthReport["publishReadiness"] {
  if (parserStatus === "failed") {
    return "blocked";
  }

  if (parserStatus === "pending" || qualityRisks.length > 0) {
    return "review";
  }

  return "ready";
}

function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new Error("Document health sizeBytes must be non-negative");
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KiB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MiB`;
}
