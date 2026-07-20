export interface TraceSummaryStep {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly name: string;
}

export interface CreateTraceSummaryInput {
  readonly maxSteps?: number | undefined;
  readonly steps: readonly TraceSummaryStep[];
}

export interface TraceSummary {
  readonly evidence: string;
  readonly filters: string;
  readonly recallCandidates: number;
  readonly rerank: string;
  readonly route: string;
}

export function createTraceSummary({
  maxSteps = 100,
  steps,
}: CreateTraceSummaryInput): TraceSummary {
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error("Trace summary maxSteps must be at least 1");
  }

  if (steps.length > maxSteps) {
    throw new Error(`Trace summary exceeds maxSteps=${maxSteps}`);
  }

  const route = findStep(steps, "route.select");
  const recall = findStep(steps, "recall.candidates");
  const filters = findStep(steps, "filters.apply");
  const rerank = findStep(steps, "rerank.apply");
  const evidence = findStep(steps, "evidence.bundle");
  const generated = findStep(steps, "query.generate");
  const generatedAttributes = generated?.attributes;
  const plan = recordAttribute(generatedAttributes, "plan");
  const metrics = recordAttribute(generatedAttributes, "metrics");
  const evidenceBundle = recordAttribute(generatedAttributes, "evidenceBundle");

  return {
    evidence: `${evidenceCount(evidence, generatedAttributes, evidenceBundle)} citations`,
    filters: formatFilters(filters),
    recallCandidates: recallCount(recall, metrics),
    rerank: rerankLabel(rerank, plan),
    route: routeLabel(route, generatedAttributes, plan),
  };
}

function findStep(steps: readonly TraceSummaryStep[], name: string): TraceSummaryStep | undefined {
  return steps.find((step) => step.name === name);
}

function stringAttribute(step: TraceSummaryStep | undefined, key: string): string {
  const value = step?.attributes[key];
  return typeof value === "string" && value ? value : "unknown";
}

function numberAttribute(step: TraceSummaryStep | undefined, key: string): number {
  const value = step?.attributes[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatFilters(step: TraceSummaryStep | undefined): string {
  if (!step) {
    return "none";
  }

  const entries = Object.entries(step.attributes)
    .filter(
      ([, value]) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean",
    )
    .sort(([left], [right]) => left.localeCompare(right));

  return entries.length > 0
    ? entries.map(([key, value]) => `${key}=${String(value)}`).join(", ")
    : "none";
}

function routeLabel(
  route: TraceSummaryStep | undefined,
  generatedAttributes: Readonly<Record<string, unknown>> | undefined,
  plan: Readonly<Record<string, unknown>> | undefined,
): string {
  const legacy = stringAttribute(route, "mode");
  if (legacy !== "unknown") {
    return legacy;
  }

  return stringFromRecord(plan, "resolvedMode") ?? stringFromRecord(generatedAttributes, "mode") ?? "unknown";
}

function recallCount(
  recall: TraceSummaryStep | undefined,
  metrics: Readonly<Record<string, unknown>> | undefined,
): number {
  const legacy = numberAttribute(recall, "count");
  if (legacy > 0) {
    return legacy;
  }

  const fusedCandidates = numberFromRecord(metrics, "fusedCandidates");
  if (fusedCandidates !== undefined) {
    return fusedCandidates;
  }

  return (numberFromRecord(metrics, "ftsCandidates") ?? 0) + (numberFromRecord(metrics, "denseCandidates") ?? 0);
}

function rerankLabel(
  rerank: TraceSummaryStep | undefined,
  plan: Readonly<Record<string, unknown>> | undefined,
): string {
  const legacyProvider = stringAttribute(rerank, "provider");
  const legacyTopK = numberAttribute(rerank, "topK");
  if (legacyProvider !== "unknown" || legacyTopK > 0) {
    return `${legacyProvider} top ${legacyTopK}`;
  }

  const rerankCandidateLimit = numberFromRecord(plan, "rerankCandidateLimit");
  if (rerankCandidateLimit !== undefined) {
    return `${rerankCandidateLimit > 0 ? "planned" : "disabled"} top ${rerankCandidateLimit}`;
  }

  return "unknown top 0";
}

function evidenceCount(
  evidence: TraceSummaryStep | undefined,
  generatedAttributes: Readonly<Record<string, unknown>> | undefined,
  evidenceBundle: Readonly<Record<string, unknown>> | undefined,
): number {
  const legacy = numberAttribute(evidence, "citations");
  if (legacy > 0) {
    return legacy;
  }

  const citations = arrayFromRecord(generatedAttributes, "citations");
  if (citations !== undefined) {
    return citations.length;
  }

  const items = arrayFromRecord(evidenceBundle, "items");
  if (items !== undefined) {
    return items.reduce<number>((count, item) => {
      return count + (isRecord(item) ? (arrayFromRecord(item, "citations")?.length ?? 0) : 0);
    }, 0);
  }

  return 0;
}

function recordAttribute(
  attributes: Readonly<Record<string, unknown>> | undefined,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = attributes?.[key];

  return isRecord(value) ? value : undefined;
}

function stringFromRecord(
  attributes: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = attributes?.[key];

  return typeof value === "string" && value ? value : undefined;
}

function numberFromRecord(
  attributes: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const value = attributes?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayFromRecord(
  attributes: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly unknown[] | undefined {
  const value = attributes?.[key];

  return Array.isArray(value) ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
