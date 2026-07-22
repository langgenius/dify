import type { AdminSseEvent } from "./api-client";

export interface RetrievalPreviewInput {
  readonly events: readonly AdminSseEvent[];
  readonly maxAnswerChars?: number | undefined;
  readonly maxCitations?: number | undefined;
}

export interface RetrievalPreviewCitation {
  readonly label: string;
  readonly nodeId: string;
}

export interface RetrievalPreview {
  readonly answer: string;
  readonly citations: readonly RetrievalPreviewCitation[];
  readonly confidenceLabel: string;
  readonly freshness: string;
  readonly status: "complete" | "streaming";
}

export function createRetrievalPreview({
  events,
  maxAnswerChars = 4_000,
  maxCitations = 8,
}: RetrievalPreviewInput): RetrievalPreview {
  if (!Number.isInteger(maxAnswerChars) || maxAnswerChars < 1) {
    throw new Error("Retrieval preview maxAnswerChars must be at least 1");
  }

  if (!Number.isInteger(maxCitations) || maxCitations < 1) {
    throw new Error("Retrieval preview maxCitations must be at least 1");
  }

  let answer = "";
  let status: RetrievalPreview["status"] = "streaming";
  let confidence = 0;
  let freshness = "Unknown";
  const citations: RetrievalPreviewCitation[] = [];

  for (const event of events) {
    if (
      event.event === "answer.delta" &&
      isRecord(event.data) &&
      typeof event.data.delta === "string"
    ) {
      answer += event.data.delta;
      if (answer.length > maxAnswerChars) {
        throw new Error(`Retrieval preview answer exceeds maxAnswerChars=${maxAnswerChars}`);
      }
    }

    if (event.event === "answer.done" && isRecord(event.data)) {
      status = "complete";
      const metadata = event.data.metadata;
      if (isRecord(metadata)) {
        confidence =
          typeof metadata.confidence === "number"
            ? clampConfidence(metadata.confidence)
            : confidence;
        freshness = typeof metadata.freshness === "string" ? metadata.freshness : freshness;
        if (Array.isArray(metadata.citations)) {
          for (const citation of metadata.citations) {
            if (citations.length >= maxCitations) {
              break;
            }

            if (
              isRecord(citation) &&
              typeof citation.label === "string" &&
              typeof citation.nodeId === "string"
            ) {
              citations.push({ label: citation.label, nodeId: citation.nodeId });
            }
          }
        }
      }
    }
  }

  return {
    answer,
    citations,
    confidenceLabel: `${Math.round(confidence * 100)}%`,
    freshness,
    status,
  };
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
