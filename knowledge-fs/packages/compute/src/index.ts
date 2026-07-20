import {
  type EvidenceBundle,
  EvidenceBundleSchema,
  type KnowledgeNode,
  KnowledgeNodeSchema,
  type ParseArtifact,
  ParseArtifactSchema,
} from "@knowledge/core";
import { isAlphabetic } from "unicode-segmenter/general";
import {
  countGraphemes as countUnicodeGraphemes,
  graphemeSegments,
} from "unicode-segmenter/grapheme";
import { z } from "zod";

import { tokenizeUnicodeWords } from "./unicode-word-segmentation";

const DEFAULT_MAX_INPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_ELEMENTS = 20_000;
const DEFAULT_MAX_CHUNK_CHARS = 1_200;
const DEFAULT_OVERLAP_CHARS = 120;
const DEFAULT_MAX_NODES = 20_000;
const DEFAULT_MAX_TOKEN_INPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_RRF_K = 60;
const DEFAULT_RRF_LIMIT = 50;
const DEFAULT_RRF_MAX_LISTS = 8;
const DEFAULT_RRF_MAX_ITEMS_PER_LIST = 1_000;
const DEFAULT_RRF_MAX_OUTPUT_ITEMS = 1_000;
const DEFAULT_EVIDENCE_MAX_ITEMS = 128;
const DEFAULT_EVIDENCE_MAX_CONTEXT_CHARS = 200_000;
const DEFAULT_DIFF_MAX_TOKENS = 20_000;
const DEFAULT_DIFF_MAX_OPERATIONS = 40_000;
const DEFAULT_DIFF_MAX_CELLS = 2_000_000;
const MAX_INPUT_VALIDATION_DEPTH = 128;
// Covers the full 20,000-element chunk contract (including element fields) with headroom.
const MAX_INPUT_VALIDATION_NODES = 500_000;
const HARD_MAX_DIFF_TOKENS = Math.min(
  DEFAULT_DIFF_MAX_TOKENS,
  Math.floor(Math.sqrt(DEFAULT_DIFF_MAX_CELLS)) - 1,
);

const DOCUMENT_ELEMENT_SEPARATOR = "\n";
const DOCUMENT_ELEMENT_TEXT_NORMALIZATION = "unicode-whitespace-trim";
const DOCUMENT_OFFSET_ENCODING = "utf-8-bytes";

export interface ChunkParseArtifactInput {
  readonly config?: ChunkConfig | undefined;
  readonly knowledgeSpaceId: string;
  readonly parseArtifact: ParseArtifact;
  readonly permissionScope?: readonly string[] | undefined;
}

export interface ChunkConfig {
  readonly maxChunkChars?: number | undefined;
  readonly maxElements?: number | undefined;
  readonly maxInputBytes?: number | undefined;
  readonly maxNodes?: number | undefined;
  readonly overlapChars?: number | undefined;
}

export interface ComputeRuntime {
  chunkParseArtifact(input: ChunkParseArtifactInput): KnowledgeNode[];
  countApproxTokens(input: string): number;
  countTokens(input: string): number;
  diffText(input: DiffTextInput): TextDiff;
  packEvidence(input: PackEvidenceInput): PackedEvidence;
  rrfFuse(input: RrfFuseInput): RrfFusedItem[];
}

export interface DiffTextInput {
  readonly config?: DiffTextConfig | undefined;
  readonly newText: string;
  readonly oldText: string;
}

export interface DiffTextConfig {
  readonly maxDiffCells?: number | undefined;
  readonly maxInputBytes?: number | undefined;
  readonly maxOperations?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly mode?: "line" | "word" | undefined;
}

export interface TextDiff {
  readonly operations: TextDiffOperation[];
  readonly stats: TextDiffStats;
}

export interface TextDiffOperation {
  readonly kind: "equal" | "insert" | "delete";
  readonly newEnd?: number | undefined;
  readonly newStart?: number | undefined;
  readonly oldEnd?: number | undefined;
  readonly oldStart?: number | undefined;
  text: string;
}

export interface TextDiffStats {
  readonly delete: number;
  readonly equal: number;
  readonly insert: number;
}

export interface PackEvidenceInput {
  readonly config?: PackEvidenceConfig | undefined;
  readonly evidenceBundle: EvidenceBundle;
  readonly model?: string | undefined;
  readonly tokenBudget: number;
}

export interface PackEvidenceConfig {
  readonly maxContextChars?: number | undefined;
  readonly maxInputBytes?: number | undefined;
  readonly maxItems?: number | undefined;
}

export interface PackedEvidence {
  readonly context: string;
  readonly items: PackedEvidenceItem[];
  readonly model?: string | undefined;
  readonly omitted: OmittedPackedEvidenceItem[];
  readonly tokenBudget: number;
  readonly usedTokens: number;
}

export interface PackedEvidenceItem {
  readonly citations: unknown[];
  readonly marker: string;
  readonly nodeId: string;
  readonly score: number;
  readonly text: string;
  readonly tokens: number;
}

export interface OmittedPackedEvidenceItem {
  readonly nodeId: string;
  readonly reason: string;
  readonly tokens: number;
}

export interface RrfFuseInput {
  readonly config?: RrfFuseConfig | undefined;
  readonly rankedLists: readonly RrfRankedList[];
}

export interface RrfFuseConfig {
  readonly k?: number | undefined;
  readonly limit?: number | undefined;
  readonly maxInputBytes?: number | undefined;
  readonly maxItemsPerList?: number | undefined;
  readonly maxLists?: number | undefined;
  readonly maxOutputItems?: number | undefined;
}

export interface RrfRankedList {
  readonly items: readonly RrfRankedItem[];
  readonly weight?: number | undefined;
}

export interface RrfRankedItem {
  readonly id: string;
  readonly payload?: Record<string, unknown> | undefined;
}

export interface RrfFusedItem {
  readonly id: string;
  payload?: Record<string, unknown> | undefined;
  readonly ranks: RrfRank[];
  readonly score: number;
}

export interface RrfRank {
  readonly listIndex: number;
  readonly rank: number;
  readonly weight: number;
}

const UuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const PositiveSafeIntegerSchema = z.number().int().positive().safe();
const NonnegativeSafeIntegerSchema = z.number().int().nonnegative().safe();
const PositiveFiniteNumberSchema = z.number().positive().refine(Number.isFinite, {
  message: "Expected a finite number",
});

const ChunkConfigSchema = z
  .object({
    maxChunkChars: PositiveSafeIntegerSchema.optional(),
    maxElements: PositiveSafeIntegerSchema.optional(),
    maxInputBytes: PositiveSafeIntegerSchema.optional(),
    maxNodes: PositiveSafeIntegerSchema.optional(),
    overlapChars: NonnegativeSafeIntegerSchema.optional(),
  })
  .strict();
const ChunkParseArtifactInputSchema = z.object({
  config: ChunkConfigSchema.optional(),
  knowledgeSpaceId: UuidSchema,
  parseArtifact: ParseArtifactSchema,
  permissionScope: z.array(z.string().min(1)).optional(),
});
const KnowledgeNodeArraySchema = z.array(KnowledgeNodeSchema);

const DiffTextConfigSchema = z
  .object({
    maxDiffCells: PositiveSafeIntegerSchema.max(DEFAULT_DIFF_MAX_CELLS).optional(),
    maxInputBytes: PositiveSafeIntegerSchema.max(DEFAULT_MAX_INPUT_BYTES).optional(),
    maxOperations: PositiveSafeIntegerSchema.max(DEFAULT_DIFF_MAX_OPERATIONS).optional(),
    maxTokens: PositiveSafeIntegerSchema.max(HARD_MAX_DIFF_TOKENS).optional(),
    mode: z.enum(["line", "word"]).optional(),
  })
  .strict();
const DiffTextInputSchema = z
  .object({
    config: DiffTextConfigSchema.optional(),
    newText: z.string(),
    oldText: z.string(),
  })
  .strict();

const JsonObjectSchema = z.record(z.string(), z.unknown());
const RrfFuseConfigSchema = z
  .object({
    k: PositiveFiniteNumberSchema.optional(),
    limit: PositiveSafeIntegerSchema.optional(),
    maxInputBytes: PositiveSafeIntegerSchema.optional(),
    maxItemsPerList: PositiveSafeIntegerSchema.optional(),
    maxLists: PositiveSafeIntegerSchema.optional(),
    maxOutputItems: PositiveSafeIntegerSchema.optional(),
  })
  .strict();
const RrfRankedItemSchema = z
  .object({ id: z.string().min(1), payload: JsonObjectSchema.optional() })
  .strict();
const RrfRankedListSchema = z
  .object({
    items: z.array(RrfRankedItemSchema),
    weight: PositiveFiniteNumberSchema.optional(),
  })
  .strict();
const RrfFuseInputSchema = z
  .object({
    config: RrfFuseConfigSchema.optional(),
    rankedLists: z.array(RrfRankedListSchema),
  })
  .strict();

const PackEvidenceConfigSchema = z
  .object({
    maxContextChars: PositiveSafeIntegerSchema.optional(),
    maxInputBytes: PositiveSafeIntegerSchema.optional(),
    maxItems: PositiveSafeIntegerSchema.optional(),
  })
  .strict();
const PackEvidenceInputSchema = z
  .object({
    config: PackEvidenceConfigSchema.optional(),
    evidenceBundle: EvidenceBundleSchema,
    model: z.string().min(1).optional(),
    tokenBudget: PositiveSafeIntegerSchema,
  })
  .strict();

interface EffectiveChunkConfig {
  maxChunkChars: number;
  maxElements: number;
  maxInputBytes: number;
  maxNodes: number;
  overlapChars: number;
}

interface TextSegment {
  elementId: string;
  elementType: string;
  endOffset: number;
  graphemeLength: number;
  metadata: Record<string, unknown>;
  pageNumber?: number | undefined;
  sectionPath: string[];
  startOffset: number;
  text: string;
}

interface DiffStep {
  kind: TextDiffOperation["kind"];
  newIndex?: number | undefined;
  oldIndex?: number | undefined;
  token: string;
}

interface DiffAccumulator {
  kind: TextDiffOperation["kind"];
  newEnd?: number | undefined;
  newStart?: number | undefined;
  oldEnd?: number | undefined;
  oldStart?: number | undefined;
  tokens: string[];
}

interface RrfAccumulator {
  id: string;
  payload?: Record<string, unknown> | undefined;
  ranks: RrfRank[];
  score: number;
}

interface GraphemeBoundary {
  endByte: number;
  endCodeUnit: number;
  startByte: number;
  startCodeUnit: number;
}

interface GraphemeSpan extends GraphemeBoundary {
  graphemeLength: number;
}

const utf8Encoder = new TextEncoder();

/** Creates the deterministic in-process compute implementation. */
export function createTypeScriptComputeRuntime(): ComputeRuntime {
  return {
    chunkParseArtifact(input) {
      return chunkParseArtifact(input);
    },
    countApproxTokens(input) {
      return countApproxTokens(input);
    },
    countTokens(input) {
      return countApproxTokens(input);
    },
    diffText(input) {
      return diffText(input);
    },
    packEvidence(input) {
      return packEvidence(input);
    },
    rrfFuse(input) {
      return rrfFuse(input);
    },
  };
}

function countApproxTokens(input: string): number {
  assertWellFormedString(input, "token input");
  if (utf8ByteLength(input) > DEFAULT_MAX_TOKEN_INPUT_BYTES) {
    throw new Error(`token input exceeds maxInputBytes=${DEFAULT_MAX_TOKEN_INPUT_BYTES}`);
  }

  let count = 0;
  let latinRunCharacters = 0;

  for (const part of graphemeSegments(input)) {
    const grapheme = part.segment;
    if ([...grapheme].every(isUnicodeWhitespace)) {
      count += approximateLatinRunTokens(latinRunCharacters);
      latinRunCharacters = 0;
      continue;
    }

    if (isLatinTokenGrapheme(grapheme)) {
      latinRunCharacters += [...grapheme].length;
      continue;
    }

    count += approximateLatinRunTokens(latinRunCharacters) + 1;
    latinRunCharacters = 0;
  }

  return count + approximateLatinRunTokens(latinRunCharacters);
}

function approximateLatinRunTokens(characterCount: number): number {
  if (characterCount === 0) {
    return 0;
  }
  return characterCount <= 8 ? 1 : Math.ceil(characterCount / 4);
}

function isLatinTokenGrapheme(grapheme: string): boolean {
  return [...grapheme].every(
    (character) =>
      character === "_" ||
      character === "-" ||
      /^[A-Za-z0-9]$/.test(character) ||
      (isAlphabetic(character.codePointAt(0) as number) && !isCjkCharacter(character)),
  );
}

function isCjkCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) as number;
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x2a6df) ||
    (codePoint >= 0x2a700 && codePoint <= 0x2b73f) ||
    (codePoint >= 0x2b740 && codePoint <= 0x2b81f) ||
    (codePoint >= 0x2b820 && codePoint <= 0x2ceaf) ||
    (codePoint >= 0x2ceb0 && codePoint <= 0x2ebef) ||
    (codePoint >= 0x30000 && codePoint <= 0x3134f)
  );
}

function chunkParseArtifact(input: ChunkParseArtifactInput): KnowledgeNode[] {
  assertWellFormedValue(input, "chunk input");
  const parsed = ChunkParseArtifactInputSchema.parse(jsonClone(input));
  const serializedBytes = jsonByteLength(parsed);
  assertWithinBytes("chunk input", serializedBytes, DEFAULT_MAX_INPUT_BYTES);
  const config: EffectiveChunkConfig = {
    maxChunkChars: parsed.config?.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS,
    maxElements: parsed.config?.maxElements ?? DEFAULT_MAX_ELEMENTS,
    maxInputBytes: parsed.config?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
    maxNodes: parsed.config?.maxNodes ?? DEFAULT_MAX_NODES,
    overlapChars: parsed.config?.overlapChars ?? DEFAULT_OVERLAP_CHARS,
  };

  if (config.overlapChars >= config.maxChunkChars) {
    throw new Error("overlapChars must be less than maxChunkChars");
  }
  assertWithinBytes("chunk input", serializedBytes, config.maxInputBytes);
  if (parsed.parseArtifact.elements.length > config.maxElements) {
    throw new Error(`parse artifact exceeds maxElements=${config.maxElements}`);
  }

  const segments = materializeSegments(parsed.parseArtifact);
  const nodes: KnowledgeNode[] = [];
  let group: TextSegment[] = [];
  let currentSection: string[] | undefined;

  const emitNode = (nodeSegments: TextSegment[], kind: KnowledgeNode["kind"]): void => {
    if (nodeSegments.length === 0) {
      return;
    }
    if (nodes.length >= config.maxNodes) {
      throw new Error(`chunk output exceeds maxNodes=${config.maxNodes}`);
    }

    const first = nodeSegments[0];
    const last = nodeSegments.at(-1);
    if (!first || !last) {
      return;
    }
    const chunkIndex = nodes.length;
    const metadata: Record<string, unknown> = {
      chunkIndex,
      elementSeparator: DOCUMENT_ELEMENT_SEPARATOR,
      elementIds: unique(nodeSegments.map((segment) => segment.elementId)),
      elementTypes: unique(nodeSegments.map((segment) => segment.elementType)),
      offsetEncoding: DOCUMENT_OFFSET_ENCODING,
      textNormalization: DOCUMENT_ELEMENT_TEXT_NORMALIZATION,
    };
    if (nodeSegments.length === 1) {
      mergeSingleSegmentMetadata(metadata, first.metadata);
    }
    const pageNumber = commonPageNumber(nodeSegments);

    nodes.push({
      artifactHash: parsed.parseArtifact.artifactHash,
      documentAssetId: parsed.parseArtifact.documentAssetId,
      endOffset: last.endOffset,
      id: uuidV5(parsed.parseArtifact.id, `${parsed.parseArtifact.artifactHash}:${chunkIndex}`),
      kind,
      knowledgeSpaceId: parsed.knowledgeSpaceId,
      metadata,
      parseArtifactId: parsed.parseArtifact.id,
      permissionScope: parsed.permissionScope ? [...parsed.permissionScope] : [],
      sourceLocation: {
        ...(pageNumber === undefined ? {} : { pageNumber }),
        sectionPath: [...first.sectionPath],
        startOffset: first.startOffset,
        endOffset: last.endOffset,
      },
      startOffset: first.startOffset,
      text: nodeSegments.map((segment) => segment.text).join(DOCUMENT_ELEMENT_SEPARATOR),
    });
  };

  const flushGroup = (): void => {
    if (group.length > 0) {
      emitNode(group, "chunk");
      group = [];
    }
  };

  const emitSegmentChunks = (segment: TextSegment, kind: KnowledgeNode["kind"]): void => {
    for (const span of graphemeSpans(segment.text, config.maxChunkChars, config.overlapChars)) {
      emitNode(
        [
          {
            ...segment,
            endOffset: segment.startOffset + span.endByte,
            graphemeLength: span.graphemeLength,
            startOffset: segment.startOffset + span.startByte,
            text: segment.text.slice(span.startCodeUnit, span.endCodeUnit),
          },
        ],
        kind,
      );
    }
  };

  for (const segment of segments) {
    if (segment.elementType === "image" || segment.elementType === "table") {
      flushGroup();
      currentSection = undefined;
      emitSegmentChunks(segment, segment.elementType);
      continue;
    }
    if (!sameStrings(currentSection, segment.sectionPath)) {
      flushGroup();
      currentSection = [...segment.sectionPath];
    }
    if (segment.graphemeLength > config.maxChunkChars) {
      flushGroup();
      emitSegmentChunks(segment, "chunk");
      continue;
    }
    const groupLength = group.reduce((sum, item) => sum + item.graphemeLength, 0);
    if (
      group.length > 0 &&
      groupLength + group.length + segment.graphemeLength > config.maxChunkChars
    ) {
      flushGroup();
    }
    group.push(segment);
  }
  flushGroup();

  return KnowledgeNodeArraySchema.parse(nodes).map(cloneKnowledgeNode);
}

function materializeSegments(parseArtifact: ParseArtifact): TextSegment[] {
  const segments: TextSegment[] = [];
  let offset = 0;
  for (const element of parseArtifact.elements) {
    const text = element.text === undefined ? undefined : trimUnicodeWhitespace(element.text);
    if (!text) {
      continue;
    }
    const startOffset = offset;
    const endOffset = startOffset + utf8ByteLength(text);
    offset = endOffset + utf8ByteLength(DOCUMENT_ELEMENT_SEPARATOR);
    segments.push({
      elementId: element.id,
      elementType: element.type,
      endOffset,
      graphemeLength: countGraphemes(text),
      metadata: jsonClone(element.metadata),
      ...(element.pageNumber === undefined ? {} : { pageNumber: element.pageNumber }),
      sectionPath: [...element.sectionPath],
      startOffset,
      text,
    });
  }
  return segments;
}

function diffText(input: DiffTextInput): TextDiff {
  assertWellFormedValue(input, "diff input");
  const parsed = DiffTextInputSchema.parse(jsonClone(input));
  const serializedBytes = jsonByteLength(parsed);
  assertWithinBytes("diff input", serializedBytes, DEFAULT_MAX_INPUT_BYTES);
  const maxDiffCells = parsed.config?.maxDiffCells ?? DEFAULT_DIFF_MAX_CELLS;
  const maxTokens =
    parsed.config?.maxTokens ??
    Math.min(DEFAULT_DIFF_MAX_TOKENS, Math.max(0, Math.floor(Math.sqrt(maxDiffCells)) - 1));
  const maxOperations = parsed.config?.maxOperations ?? DEFAULT_DIFF_MAX_OPERATIONS;
  const maxInputBytes = parsed.config?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const mode = parsed.config?.mode ?? "line";

  if (maxTokens < 1) {
    throw new Error("maxTokens must be at least 1");
  }
  if ((maxTokens + 1) * (maxTokens + 1) > maxDiffCells) {
    throw new Error("maxTokens must fit within maxDiffCells");
  }
  assertWithinBytes("diff input", serializedBytes, maxInputBytes);
  const oldTokens = tokenizeDiffText(parsed.oldText, mode, maxTokens + 1);
  const newTokens = tokenizeDiffText(parsed.newText, mode, maxTokens + 1);
  if (oldTokens.length > maxTokens || newTokens.length > maxTokens) {
    throw new Error(`diff token count exceeds maxTokens=${maxTokens}`);
  }
  const cells = (oldTokens.length + 1) * (newTokens.length + 1);
  if (!Number.isSafeInteger(cells)) {
    throw new Error("diff matrix cell count overflowed");
  }
  if (cells > maxDiffCells) {
    throw new Error(`diff matrix exceeds maxDiffCells=${maxDiffCells}`);
  }

  const operations = buildLcsDiff(oldTokens, newTokens, mode);
  if (operations.length > maxOperations) {
    throw new Error(`diff operations exceed maxOperations=${maxOperations}`);
  }
  const stats: Record<TextDiffOperation["kind"], number> = { delete: 0, equal: 0, insert: 0 };
  for (const operation of operations) {
    const tokenCount = tokenizeOperationText(operation.text, mode).length;
    stats[operation.kind] += tokenCount;
  }
  return { operations, stats };
}

function tokenizeDiffText(text: string, mode: "line" | "word", limit: number): string[] {
  if (mode === "word") {
    return tokenizeUnicodeWords(text, limit);
  }
  if (text.length === 0) {
    return [];
  }
  const lines: string[] = [];
  let start = 0;
  while (start < text.length && lines.length < limit) {
    const lineFeed = text.indexOf("\n", start);
    if (lineFeed === -1) {
      lines.push(text.slice(start));
      break;
    }
    const end =
      lineFeed > start && text.charCodeAt(lineFeed - 1) === 0x0d ? lineFeed - 1 : lineFeed;
    lines.push(text.slice(start, end));
    start = lineFeed + 1;
  }
  return lines;
}

function tokenizeOperationText(text: string, mode: "line" | "word"): string[] {
  if (text === "") {
    return [""];
  }
  return mode === "line" ? text.split("\n") : text.split(" ");
}

function buildLcsDiff(
  oldTokens: string[],
  newTokens: string[],
  mode: "line" | "word",
): TextDiffOperation[] {
  const columns = newTokens.length + 1;
  const matrix = new Uint32Array((oldTokens.length + 1) * columns);
  for (let oldIndex = 1; oldIndex <= oldTokens.length; oldIndex += 1) {
    for (let newIndex = 1; newIndex <= newTokens.length; newIndex += 1) {
      const index = oldIndex * columns + newIndex;
      matrix[index] =
        oldTokens[oldIndex - 1] === newTokens[newIndex - 1]
          ? (matrix[(oldIndex - 1) * columns + newIndex - 1] as number) + 1
          : Math.max(
              matrix[(oldIndex - 1) * columns + newIndex] as number,
              matrix[oldIndex * columns + newIndex - 1] as number,
            );
    }
  }

  const steps: DiffStep[] = [];
  let oldIndex = oldTokens.length;
  let newIndex = newTokens.length;
  while (oldIndex > 0 || newIndex > 0) {
    if (oldIndex > 0 && newIndex > 0 && oldTokens[oldIndex - 1] === newTokens[newIndex - 1]) {
      steps.push({
        kind: "equal",
        oldIndex,
        newIndex,
        token: oldTokens[oldIndex - 1] as string,
      });
      oldIndex -= 1;
      newIndex -= 1;
    } else if (
      newIndex > 0 &&
      (oldIndex === 0 ||
        (matrix[oldIndex * columns + newIndex - 1] as number) >=
          (matrix[(oldIndex - 1) * columns + newIndex] as number))
    ) {
      steps.push({ kind: "insert", newIndex, token: newTokens[newIndex - 1] as string });
      newIndex -= 1;
    } else {
      steps.push({ kind: "delete", oldIndex, token: oldTokens[oldIndex - 1] as string });
      oldIndex -= 1;
    }
  }
  steps.reverse();

  const accumulators: DiffAccumulator[] = [];
  for (const step of steps) {
    const last = accumulators.at(-1);
    if (last?.kind === step.kind) {
      last.oldStart ??= step.oldIndex;
      last.newStart ??= step.newIndex;
      if (step.oldIndex !== undefined) last.oldEnd = step.oldIndex;
      if (step.newIndex !== undefined) last.newEnd = step.newIndex;
      last.tokens.push(step.token);
    } else {
      accumulators.push({
        kind: step.kind,
        ...(step.newIndex === undefined ? {} : { newStart: step.newIndex, newEnd: step.newIndex }),
        ...(step.oldIndex === undefined ? {} : { oldStart: step.oldIndex, oldEnd: step.oldIndex }),
        tokens: [step.token],
      });
    }
  }
  const separator = mode === "line" ? "\n" : " ";
  return accumulators.map(({ tokens, ...operation }) => ({
    ...operation,
    text: tokens.join(separator),
  }));
}

function rrfFuse(input: RrfFuseInput): RrfFusedItem[] {
  assertWellFormedValue(input, "RRF input");
  const parsed = RrfFuseInputSchema.parse(jsonClone(input));
  const serializedBytes = jsonByteLength(parsed);
  assertWithinBytes("RRF input", serializedBytes, DEFAULT_MAX_INPUT_BYTES);
  const k = parsed.config?.k ?? DEFAULT_RRF_K;
  const limit = parsed.config?.limit ?? DEFAULT_RRF_LIMIT;
  const maxInputBytes = parsed.config?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const maxItemsPerList = parsed.config?.maxItemsPerList ?? DEFAULT_RRF_MAX_ITEMS_PER_LIST;
  const maxLists = parsed.config?.maxLists ?? DEFAULT_RRF_MAX_LISTS;
  const maxOutputItems = parsed.config?.maxOutputItems ?? DEFAULT_RRF_MAX_OUTPUT_ITEMS;
  if (limit > maxOutputItems) {
    throw new Error("limit must be less than or equal to maxOutputItems");
  }
  assertWithinBytes("RRF input", serializedBytes, maxInputBytes);
  if (parsed.rankedLists.length > maxLists) {
    throw new Error(`rankedLists exceeds maxLists=${maxLists}`);
  }

  const byId = new Map<string, RrfAccumulator>();
  parsed.rankedLists.forEach((list, listIndex) => {
    if (list.items.length > maxItemsPerList) {
      throw new Error(`ranked list exceeds maxItemsPerList=${maxItemsPerList}`);
    }
    const weight = list.weight ?? 1;
    const seen = new Set<string>();
    list.items.forEach((item, zeroRank) => {
      if (item.id.trim().length === 0) {
        throw new Error("ranked item id must be non-empty");
      }
      if (seen.has(item.id)) {
        return;
      }
      seen.add(item.id);
      const rank = zeroRank + 1;
      const scoreDelta = weight / (k + rank);
      if (!Number.isFinite(scoreDelta)) {
        throw new Error("RRF score must remain finite");
      }
      const existing = byId.get(item.id);
      if (existing) {
        existing.payload ??= item.payload ? jsonClone(item.payload) : undefined;
        const score = existing.score + scoreDelta;
        if (!Number.isFinite(score)) {
          throw new Error("RRF score must remain finite");
        }
        existing.score = score;
        existing.ranks.push({ listIndex, rank, weight });
      } else {
        byId.set(item.id, {
          id: item.id,
          ...(item.payload ? { payload: jsonClone(item.payload) } : {}),
          ranks: [{ listIndex, rank, weight }],
          score: scoreDelta,
        });
      }
    });
    if (byId.size > maxOutputItems) {
      throw new Error(`RRF output candidates exceed maxOutputItems=${maxOutputItems}`);
    }
  });

  return [...byId.values()]
    .sort((left, right) => right.score - left.score || compareUtf8(left.id, right.id))
    .slice(0, limit)
    .map(cloneRrfFusedItem);
}

function packEvidence(input: PackEvidenceInput): PackedEvidence {
  assertWellFormedValue(input, "evidence packing input");
  const parsed = PackEvidenceInputSchema.parse(jsonClone(input));
  const serializedBytes = jsonByteLength(parsed);
  assertWithinBytes("evidence packing input", serializedBytes, DEFAULT_MAX_INPUT_BYTES);
  const maxContextChars = parsed.config?.maxContextChars ?? DEFAULT_EVIDENCE_MAX_CONTEXT_CHARS;
  const maxInputBytes = parsed.config?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const maxItems = parsed.config?.maxItems ?? DEFAULT_EVIDENCE_MAX_ITEMS;
  assertWithinBytes("evidence packing input", serializedBytes, maxInputBytes);
  if (parsed.evidenceBundle.items.length > maxItems) {
    throw new Error(`evidence item count exceeds maxItems=${maxItems}`);
  }

  let usedTokens = 0;
  const contextParts: string[] = [];
  const items: PackedEvidenceItem[] = [];
  const omitted: OmittedPackedEvidenceItem[] = [];
  for (const item of parsed.evidenceBundle.items) {
    const text = trimUnicodeWhitespace(item.text);
    if (!text) {
      continue;
    }
    const tokens = countApproxTokens(text);
    if (usedTokens + tokens > parsed.tokenBudget) {
      omitted.push({ nodeId: item.nodeId, reason: "token-budget", tokens });
      continue;
    }
    const marker = `E${items.length + 1}`;
    contextParts.push(`[${marker}] ${text}`);
    if (countGraphemes(contextParts.join("\n\n")) > maxContextChars) {
      throw new Error(`packed evidence context exceeds maxContextChars=${maxContextChars}`);
    }
    usedTokens += tokens;
    items.push({
      citations: jsonClone(item.citations),
      marker,
      nodeId: item.nodeId,
      score: item.score,
      text,
      tokens,
    });
  }

  return {
    context: contextParts.join("\n\n"),
    items,
    ...(parsed.model === undefined ? {} : { model: parsed.model }),
    omitted,
    tokenBudget: parsed.tokenBudget,
    usedTokens,
  };
}

function countGraphemes(text: string): number {
  return countUnicodeGraphemes(text);
}

function trimUnicodeWhitespace(text: string): string {
  let start = 0;
  while (start < text.length) {
    const codePoint = text.codePointAt(start) as number;
    if (!isUnicodeWhitespace(String.fromCodePoint(codePoint))) break;
    start += codePoint > 0xffff ? 2 : 1;
  }

  let end = text.length;
  while (end > start) {
    const lastCodeUnit = text.charCodeAt(end - 1);
    const characterStart =
      lastCodeUnit >= 0xdc00 && lastCodeUnit <= 0xdfff && end >= 2 ? end - 2 : end - 1;
    const codePoint = text.codePointAt(characterStart) as number;
    if (!isUnicodeWhitespace(String.fromCodePoint(codePoint))) break;
    end = characterStart;
  }
  return text.slice(start, end);
}

function isUnicodeWhitespace(character: string): boolean {
  const codePoint = character.codePointAt(0) as number;
  return (
    (codePoint >= 0x0009 && codePoint <= 0x000d) ||
    codePoint === 0x0020 ||
    codePoint === 0x0085 ||
    codePoint === 0x00a0 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000
  );
}

function graphemeSpans(text: string, maxChars: number, overlapChars: number): GraphemeSpan[] {
  const spans: GraphemeSpan[] = [];
  let active: GraphemeBoundary[] = [];
  let byteOffset = 0;

  for (const part of graphemeSegments(text)) {
    const startByte = byteOffset;
    byteOffset += utf8ByteLength(part.segment);
    active.push({
      endByte: byteOffset,
      endCodeUnit: part.index + part.segment.length,
      startByte,
      startCodeUnit: part.index,
    });
    if (active.length === maxChars) {
      spans.push(toGraphemeSpan(active));
      active = overlapChars === 0 ? [] : active.slice(-overlapChars);
    }
  }

  if (active.length > overlapChars || spans.length === 0) {
    spans.push(toGraphemeSpan(active));
  }
  return spans;
}

function toGraphemeSpan(boundaries: GraphemeBoundary[]): GraphemeSpan {
  const first = boundaries[0] as GraphemeBoundary;
  const last = boundaries.at(-1) as GraphemeBoundary;
  return {
    endByte: last.endByte,
    endCodeUnit: last.endCodeUnit,
    graphemeLength: boundaries.length,
    startByte: first.startByte,
    startCodeUnit: first.startCodeUnit,
  };
}

function mergeSingleSegmentMetadata(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key of [
    "assetRef",
    "boundingBox",
    "caption",
    "ocrText",
    "table",
    "textAsHtml",
    "title",
  ]) {
    if (Object.hasOwn(source, key)) {
      target[key] = jsonClone(source[key]);
    }
  }
}

function commonPageNumber(segments: TextSegment[]): number | undefined {
  const first = (segments[0] as TextSegment).pageNumber;
  return segments.every((segment) => segment.pageNumber === first) ? first : undefined;
}

function sameStrings(left: string[] | undefined, right: string[]): boolean {
  return (
    left !== undefined && left.length === right.length && left.every((item, i) => item === right[i])
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uuidV5(namespace: string, name: string): string {
  const namespaceHex = namespace.replaceAll("-", "");
  const namespaceBytes = Uint8Array.from({ length: namespaceHex.length / 2 }, (_, index) =>
    Number.parseInt(namespaceHex.slice(index * 2, index * 2 + 2), 16),
  );
  const nameBytes = utf8Encoder.encode(name);
  const input = new Uint8Array(namespaceBytes.length + nameBytes.length);
  input.set(namespaceBytes);
  input.set(nameBytes, namespaceBytes.length);
  const bytes = sha1(input).slice(0, 16);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}

function assertWithinBytes(label: string, actual: number, maximum: number): void {
  if (actual > maximum) {
    throw new Error(`${label} exceeds maxInputBytes=${maximum}`);
  }
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = utf8Encoder.encode(left);
  const rightBytes = utf8Encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function assertWellFormedValue(value: unknown, label: string): void {
  const pending: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
  const seen = new WeakSet<object>();
  let visitedNodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    visitedNodes += 1;
    if (visitedNodes > MAX_INPUT_VALIDATION_NODES) {
      throw new Error(`${label} exceeds validation nodes=${MAX_INPUT_VALIDATION_NODES}`);
    }
    if (typeof current.value === "string") {
      assertWellFormedString(current.value, label);
      continue;
    }
    if (current.value === null || typeof current.value !== "object") continue;
    if (seen.has(current.value)) continue;
    seen.add(current.value);
    const pushChild = (key: string, item: unknown): void => {
      if (current.depth >= MAX_INPUT_VALIDATION_DEPTH) {
        throw new Error(`${label} exceeds validation depth=${MAX_INPUT_VALIDATION_DEPTH}`);
      }
      if (visitedNodes + pending.length >= MAX_INPUT_VALIDATION_NODES) {
        throw new Error(`${label} exceeds validation nodes=${MAX_INPUT_VALIDATION_NODES}`);
      }
      assertWellFormedString(key, label);
      pending.push({ depth: current.depth + 1, value: item });
    };
    if (Array.isArray(current.value)) {
      for (let index = 0; index < current.value.length; index += 1) {
        pushChild(String(index), current.value[index]);
      }
    } else {
      const record = current.value as Record<string, unknown>;
      for (const key in record) {
        if (Object.hasOwn(record, key)) pushChild(key, record[key]);
      }
    }
  }
}

function assertWellFormedString(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`${label} contains unpaired surrogate`);
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Error(`${label} contains unpaired surrogate`);
    }
  }
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

function sha1(input: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const message = new Uint8Array(paddedLength);
  message.set(input);
  message[input.length] = 0x80;
  const bitLength = input.length * 8;
  const view = new DataView(message.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const words = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 80; index += 1) {
      words[index] = rotateLeft(
        (words[index - 3] as number) ^
          (words[index - 8] as number) ^
          (words[index - 14] as number) ^
          (words[index - 16] as number),
        1,
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let index = 0; index < 80; index += 1) {
      let f: number;
      let k: number;
      if (index < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (index < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temporary = (rotateLeft(a, 5) + f + e + k + (words[index] as number)) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temporary;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const output = new Uint8Array(20);
  const outputView = new DataView(output.buffer);
  [h0, h1, h2, h3, h4].forEach((word, index) => outputView.setUint32(index * 4, word, false));
  return output;
}

function rotateLeft(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

function cloneKnowledgeNode(node: KnowledgeNode): KnowledgeNode {
  return jsonClone(node);
}

function cloneRrfFusedItem(item: RrfFusedItem): RrfFusedItem {
  return jsonClone(item);
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
