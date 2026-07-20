export interface AdminApiClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly maxAssetBytes?: number;
  readonly maxListLimit?: number;
  readonly maxGraphDepth?: number;
  readonly maxGraphFanout?: number;
  readonly maxGraphNodes?: number;
  readonly maxGraphTimeoutMs?: number;
  readonly maxJsonBytes?: number;
  readonly maxQueryBytes?: number;
  readonly maxSseBytes?: number;
  readonly maxUploadBytes?: number;
}

export interface AdminHealthStatus {
  readonly components: Readonly<Record<string, boolean>>;
  readonly ok: boolean;
  readonly runtime: "cloudflare-workers" | "node-docker";
}

export interface AdminKnowledgeSpace {
  readonly createdAt: string;
  readonly description?: string | undefined;
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly tenantId: string;
  readonly updatedAt: string;
}

export interface AdminKnowledgeSpaceList {
  readonly items: readonly AdminKnowledgeSpace[];
  readonly nextCursor?: string | undefined;
}

export interface AdminKnowledgeSpaceManifest {
  readonly consistencyPolicy: Readonly<Record<string, unknown>>;
  readonly manifestVersion: number;
  readonly objectKeyPrefix: string;
  readonly parserPolicyVersion: string;
  readonly projectionSetVersion: string;
  readonly quotaPolicy: Readonly<Record<string, unknown>>;
  readonly storageProvider: string;
}

export interface AdminKnowledgeSpaceStatus {
  readonly index?: Readonly<Record<string, unknown>> | undefined;
  readonly manifest?: Readonly<Record<string, unknown>> | undefined;
  readonly parser?: Readonly<Record<string, unknown>> | undefined;
  readonly runtime?: Readonly<Record<string, unknown>> | undefined;
  readonly storage?: Readonly<Record<string, unknown>> | undefined;
}

export interface GetKnowledgeSpaceControlPlaneInput {
  readonly knowledgeSpaceId: string;
  readonly token: string;
}

export interface ListKnowledgeSpaceDiagnosticsInput extends GetKnowledgeSpaceControlPlaneInput {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface AdminKnowledgeSpaceStagedCommit {
  readonly errorCode?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly expiresAt?: string | undefined;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly operationType: string;
  readonly status: string;
  readonly updatedAt: string;
}

export interface AdminKnowledgeSpaceStagedCommitList {
  readonly items: readonly AdminKnowledgeSpaceStagedCommit[];
  readonly nextCursor?: string | undefined;
}

export interface AdminKnowledgeFsLease {
  readonly expiresAt: string;
  readonly heartbeatAt: string;
  readonly id: string;
  readonly leaseType: string;
  readonly status: string;
  readonly targetId: string;
  readonly targetType: string;
  readonly virtualPath: string;
}

export interface AdminKnowledgeFsLeaseList {
  readonly items: readonly AdminKnowledgeFsLease[];
  readonly nextCursor?: string | undefined;
}

export type AdminKnowledgeFsckCheck = "artifact-segments" | "raw-objects" | "references";

export interface GetKnowledgeFsckInput extends GetKnowledgeSpaceControlPlaneInput {
  readonly check: AdminKnowledgeFsckCheck;
  readonly cursor?: string | undefined;
}

export interface AdminKnowledgeFsckIssue {
  readonly code: string;
  readonly message: string;
  readonly repairability: string;
  readonly severity: string;
  readonly target: Readonly<Record<string, unknown>>;
  readonly type: string;
}

export interface AdminKnowledgeFsckReport {
  readonly cursor?: string | undefined;
  readonly issues: readonly AdminKnowledgeFsckIssue[];
  readonly knowledgeSpaceId: string;
  readonly scannedAt: string;
  readonly summary: Readonly<Record<string, number>>;
  readonly tenantId: string;
}

export interface AdminKnowledgeFsGcCandidate {
  readonly candidateType: string;
  readonly count: number;
  readonly estimatedBytes: number;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly target: Readonly<Record<string, unknown>>;
}

export interface AdminKnowledgeFsGcDryRunReport {
  readonly candidates: readonly AdminKnowledgeFsGcCandidate[];
  readonly cursor?: string | undefined;
  readonly dryRunId: string;
  readonly generatedAt: string;
  readonly knowledgeSpaceId: string;
  readonly summary: Readonly<Record<string, number>>;
  readonly tenantId: string;
}

export interface GetKnowledgeFsStagedObjectGcInput extends GetKnowledgeSpaceControlPlaneInput {
  readonly cursor?: string | undefined;
}

export interface ExecuteKnowledgeFsStagedObjectGcInput extends GetKnowledgeSpaceControlPlaneInput {
  readonly candidates: readonly AdminKnowledgeFsGcCandidate[];
  readonly dryRunId: string;
  readonly idempotencyKey: string;
}

export interface AdminKnowledgeFsStagedObjectGcExecuteResult {
  readonly deleted: number;
  readonly items: readonly {
    readonly idempotencyKey: string;
    readonly objectKey: string;
    readonly status: string;
  }[];
  readonly skipped: number;
  readonly tenantId: string;
}

export interface MaterializeSemanticTopicViewInput extends GetKnowledgeSpaceControlPlaneInput {
  readonly generatedVersion?: string | undefined;
  readonly limit?: number | undefined;
  readonly topicName?: string | undefined;
  readonly topicSlug?: string | undefined;
}

export interface AdminSemanticTopicMaterializationResult {
  readonly documentCount: number;
  readonly generatedVersion: string;
  readonly knowledgeSpaceId: string;
  readonly pathCount: number;
  readonly topicName: string;
  readonly topicSlug: string;
}

export interface MaterializeSemanticCommunitiesInput extends GetKnowledgeSpaceControlPlaneInput {
  readonly generatedVersion?: string | undefined;
}

export interface AdminSemanticCommunityMaterializationResult {
  readonly communityCount: number;
  readonly documentCount: number;
  readonly entityCount: number;
  readonly generatedVersion: string;
  readonly knowledgeSpaceId: string;
  readonly pathCount: number;
}

export interface ExtractSemanticEntitiesInput extends GetKnowledgeSpaceControlPlaneInput {
  readonly limit?: number | undefined;
}

export interface AdminSemanticEntityExtractionResult {
  readonly entitiesExtracted: number;
  readonly extractionMode: "provider";
  readonly graphEntitiesIndexed: number;
  readonly graphRelationsIndexed: number;
  readonly knowledgeSpaceId: string;
  readonly nodesScanned: number;
  readonly nodesUpdated: number;
}

export interface AdminGoldenQuestion {
  readonly createdAt: string;
  readonly expectedEvidenceIds: readonly string[];
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly question: string;
  readonly tags: readonly string[];
  readonly updatedAt: string;
}

export interface AdminGoldenQuestionList {
  readonly items: readonly AdminGoldenQuestion[];
  readonly nextCursor?: string | undefined;
}

export interface ListKnowledgeSpacesInput {
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly token: string;
}

export interface ListGoldenQuestionsInput {
  readonly cursor?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly token: string;
}

export interface CreateGoldenQuestionInput {
  readonly expectedEvidenceIds?: readonly string[] | undefined;
  readonly knowledgeSpaceId: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly question: string;
  readonly tags?: readonly string[] | undefined;
  readonly token: string;
}

export interface CaptureProductionBadCaseInput {
  readonly knowledgeSpaceId: string;
  readonly reason?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly token: string;
  readonly traceId: string;
}

export type AdminAnswerCorrectness =
  | "correct"
  | "incorrect"
  | "not-answerable"
  | "partially-correct";

export interface AdminEvidenceRelevanceInput {
  readonly evidenceId: string;
  readonly note?: string | undefined;
  readonly relevant: boolean;
}

export interface GetGoldenQuestionInput {
  readonly knowledgeSpaceId: string;
  readonly questionId: string;
  readonly token: string;
}

export interface AnnotateGoldenQuestionInput extends GetGoldenQuestionInput {
  readonly answerCorrectness: AdminAnswerCorrectness;
  readonly evidenceRelevance: readonly AdminEvidenceRelevanceInput[];
  readonly note?: string | undefined;
}

export interface UpdateGoldenQuestionInput extends GetGoldenQuestionInput {
  readonly expectedEvidenceIds?: readonly string[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly question?: string | undefined;
  readonly tags?: readonly string[] | undefined;
}

export type DeleteGoldenQuestionInput = GetGoldenQuestionInput;

export interface StreamQueryInput {
  readonly knowledgeSpaceId: string;
  readonly mode?: "deep" | "fast" | "research" | undefined;
  readonly query: string;
  readonly token: string;
}

export interface UploadDocumentInput {
  readonly file: File;
  readonly knowledgeSpaceId: string;
  readonly sourceId?: string | undefined;
  readonly token: string;
}

export interface GetDocumentInput {
  readonly documentId: string;
  readonly knowledgeSpaceId: string;
  readonly token: string;
}

export interface GetDocumentMultimodalAssetInput extends GetDocumentInput {
  readonly itemId: string;
  readonly variant?: string | undefined;
}

export interface ListDocumentsInput {
  readonly cursor?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly token: string;
}

export interface GetParseArtifactInput extends GetDocumentInput {
  readonly version: number;
}

export interface TraverseGraphInput {
  readonly depth?: number | undefined;
  readonly entityId: string;
  readonly fanout?: number | undefined;
  readonly knowledgeSpaceId: string;
  readonly maxNodes?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly token: string;
}

export interface ListKnowledgeFsInput {
  readonly cursor?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly path: string;
  readonly token: string;
}

export interface ReadKnowledgeFsInput extends Omit<ListKnowledgeFsInput, "limit"> {
  readonly limit?: number | undefined;
}

export interface TreeKnowledgeFsInput extends ListKnowledgeFsInput {
  readonly depth?: number | undefined;
}

export interface GrepKnowledgeFsInput extends ListKnowledgeFsInput {
  readonly q: string;
  readonly timeoutMs?: number | undefined;
}

export interface FindKnowledgeFsInput extends ListKnowledgeFsInput {
  readonly metadataKey?: string | undefined;
  readonly metadataValue?: string | undefined;
  readonly nameContains?: string | undefined;
  readonly resourceType?: AdminKnowledgeFsEntry["resourceType"] | undefined;
}

export interface OpenKnowledgeFsNodeInput extends GetKnowledgeSpaceControlPlaneInput {
  readonly nodeId: string;
}

export type AdminSemanticView = "by-community" | "by-entity" | "by-topic";

export interface ListSemanticViewInput {
  readonly cursor?: string | undefined;
  readonly key?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly token: string;
  readonly view: AdminSemanticView;
}

export type AdminKnowledgeFsDiffMode = "line" | "word";

export interface DiffKnowledgeFsInput {
  readonly knowledgeSpaceId: string;
  readonly mode?: AdminKnowledgeFsDiffMode | undefined;
  readonly newPath: string;
  readonly oldPath: string;
  readonly semantic?: boolean | undefined;
  readonly token: string;
}

export interface WriteKnowledgeFsInput extends GetKnowledgeSpaceControlPlaneInput {
  readonly path: string;
  readonly text: string;
}

export interface AdminDocumentAsset {
  readonly createdAt: string;
  readonly filename: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly mimeType: string;
  readonly objectKey: string;
  readonly parserStatus: "failed" | "parsed" | "pending";
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly sourceId?: string | undefined;
  readonly version: number;
}

export interface AdminDocumentAssetList {
  readonly items: readonly AdminDocumentAsset[];
  readonly nextCursor?: string | undefined;
}

export interface AdminDocumentOutlineTitleLocation {
  readonly confidence: number;
  readonly endOffset?: number | undefined;
  readonly matchedText?: string | undefined;
  readonly pageNumber?: number | undefined;
  readonly source: "fallback" | "llm-inferred" | "native-toc" | "parser-heading";
  readonly startOffset?: number | undefined;
}

export interface AdminDocumentOutlineNode {
  readonly childNodeIds: readonly string[];
  readonly children: readonly AdminDocumentOutlineNode[];
  readonly endOffset?: number | undefined;
  readonly endPage?: number | undefined;
  readonly id: string;
  readonly level: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sectionPath: readonly string[];
  readonly sourceElementIds: readonly string[];
  readonly sourceNodeIds: readonly string[];
  readonly startOffset?: number | undefined;
  readonly startPage?: number | undefined;
  readonly summary?: string | undefined;
  readonly title: string;
  readonly titleLocation?: AdminDocumentOutlineTitleLocation | undefined;
  readonly tocSource: "fallback" | "llm-inferred" | "native-toc" | "parser-heading";
}

export interface AdminDocumentOutline {
  readonly artifactHash: string;
  readonly createdAt: string;
  readonly documentAssetId: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly nodes: readonly AdminDocumentOutlineNode[];
  readonly outlineVersion: string;
  readonly parseArtifactId: string;
  readonly updatedAt?: string | undefined;
  readonly version: number;
}

export interface AdminDocumentMultimodalItem {
  readonly assetRef?: AdminDocumentMultimodalAssetRef | undefined;
  readonly boundingBox?: AdminDocumentMultimodalBoundingBox | undefined;
  readonly caption?: string | undefined;
  readonly endOffset?: number | undefined;
  readonly enrichment: Readonly<Record<string, string>>;
  readonly id: string;
  readonly modality: "code" | "image" | "page" | "table";
  readonly ocrText?: string | undefined;
  readonly pageNumber?: number | undefined;
  readonly parseElementId: string;
  readonly sectionPath: readonly string[];
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
  readonly startOffset?: number | undefined;
  readonly textPreview?: string | undefined;
  readonly title?: string | undefined;
}

export interface AdminDocumentMultimodalBoundingBox {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface AdminDocumentMultimodalAssetRef {
  readonly contentType?: string | undefined;
  readonly objectKey?: string | undefined;
  readonly sha256?: string | undefined;
  readonly uri?: string | undefined;
  readonly variants?: Readonly<Record<string, AdminDocumentMultimodalAssetVariant>> | undefined;
}

export interface AdminDocumentMultimodalAssetVariant {
  readonly contentType?: string | undefined;
  readonly height?: number | undefined;
  readonly objectKey?: string | undefined;
  readonly sha256?: string | undefined;
  readonly uri?: string | undefined;
  readonly width?: number | undefined;
}

export interface AdminDocumentMultimodalManifest {
  readonly artifactHash: string;
  readonly createdAt: string;
  readonly documentAssetId: string;
  readonly id: string;
  readonly items: readonly AdminDocumentMultimodalItem[];
  readonly knowledgeSpaceId: string;
  readonly manifestVersion: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly parseArtifactId: string;
  readonly updatedAt?: string | undefined;
  readonly version: number;
}

export interface AdminDocumentMultimodalAsset {
  readonly bytes: ArrayBuffer;
  readonly contentType: string;
  readonly itemId?: string | undefined;
}

export interface AdminParseElement {
  readonly id: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly pageNumber?: number | undefined;
  readonly sectionPath: readonly string[];
  readonly text?: string | undefined;
  readonly type:
    | "code"
    | "heading"
    | "image"
    | "list"
    | "page-break"
    | "paragraph"
    | "table"
    | "title";
}

export interface AdminParseArtifact {
  readonly artifactHash: string;
  readonly contentType: "mixed" | "structured" | "text";
  readonly createdAt: string;
  readonly documentAssetId: string;
  readonly elements: readonly AdminParseElement[];
  readonly id: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly parser: "native-html" | "native-markdown" | "native-structured" | "unstructured";
  readonly version: number;
}

export type AdminGraphEntityType =
  | "date"
  | "metric"
  | "organization"
  | "person"
  | "policy"
  | "product"
  | "term";

export type AdminGraphRelationType =
  | "contradicts"
  | "defines"
  | "depends_on"
  | "mentions"
  | "references"
  | "supersedes";

export interface AdminGraphEntity {
  readonly aliases: readonly string[];
  readonly canonicalKey: string;
  readonly confidence: number;
  readonly createdAt: string;
  readonly depth: number;
  readonly extractionVersion: number;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly permissionScope: readonly string[];
  readonly sourceNodeIds: readonly string[];
  readonly type: AdminGraphEntityType;
  readonly updatedAt: string;
}

export interface AdminGraphRelation {
  readonly confidence: number;
  readonly createdAt: string;
  readonly depth: number;
  readonly extractionVersion: number;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly objectEntityId: string;
  readonly permissionScope: readonly string[];
  readonly sourceNodeIds: readonly string[];
  readonly subjectEntityId: string;
  readonly type: AdminGraphRelationType;
  readonly updatedAt: string;
}

export interface AdminGraphTraversal {
  readonly entities: readonly AdminGraphEntity[];
  readonly metrics: {
    readonly depthReached: number;
    readonly elapsedMs: number;
    readonly exploredRelations: number;
    readonly fanout: number;
    readonly maxDepth: number;
    readonly maxNodes: number;
    readonly timedOut: boolean;
  };
  readonly relations: readonly AdminGraphRelation[];
  readonly truncated: boolean;
}

export interface AdminKnowledgeFsEntry {
  readonly kind: "directory" | "resource";
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly path: string;
  readonly resourceType?:
    | "answer-trace"
    | "document"
    | "evidence-bundle"
    | "node"
    | "knowledge-node"
    | "artifact"
    | "parse-artifact"
    | "source"
    | "workspace"
    | undefined;
  readonly targetId?: string | undefined;
  readonly version?: number | undefined;
}

export interface AdminKnowledgeFsList {
  readonly items: readonly AdminKnowledgeFsEntry[];
  readonly nextCursor?: string | undefined;
  readonly path: string;
  readonly truncated: boolean;
}

export interface AdminKnowledgeFsTreeNode extends AdminKnowledgeFsEntry {
  readonly children?: readonly AdminKnowledgeFsTreeNode[] | undefined;
}

export interface AdminKnowledgeFsTree {
  readonly nextCursor?: string | undefined;
  readonly path: string;
  readonly root: AdminKnowledgeFsTreeNode;
  readonly truncated: boolean;
}

export interface AdminKnowledgeFsCat {
  readonly contentType: string;
  readonly nextCursor?: string | undefined;
  readonly path: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface AdminKnowledgeFsStat {
  readonly contentType?: string | undefined;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly parserStatus?: AdminDocumentAsset["parserStatus"] | undefined;
  readonly path: string;
  readonly resourceType: NonNullable<AdminKnowledgeFsEntry["resourceType"]>;
  readonly sha256?: string | undefined;
  readonly sizeBytes?: number | undefined;
  readonly targetId: string;
  readonly version?: number | undefined;
}

export interface AdminKnowledgeFsGrepMatch {
  readonly endOffset: number;
  readonly kind: "node" | "segment";
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly nodeId?: string | undefined;
  readonly path: string;
  readonly segmentId?: string | undefined;
  readonly snippet: string;
  readonly startOffset: number;
}

export interface AdminKnowledgeFsGrep {
  readonly matches: readonly AdminKnowledgeFsGrepMatch[];
  readonly nextCursor?: string | undefined;
  readonly path: string;
  readonly truncated: boolean;
}

export interface AdminKnowledgeFsOpenNode {
  readonly citation: {
    readonly artifactHash: string;
    readonly documentAssetId: string;
    readonly endOffset: number;
    readonly pageNumber?: number | undefined;
    readonly parseArtifactId: string;
    readonly sectionPath: readonly string[];
    readonly startOffset: number;
  };
  readonly node: {
    readonly id: string;
    readonly kind: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly text: string;
  };
}

export interface AdminTextDiffOperation {
  readonly kind: "delete" | "equal" | "insert";
  readonly newEnd?: number | undefined;
  readonly newStart?: number | undefined;
  readonly oldEnd?: number | undefined;
  readonly oldStart?: number | undefined;
  readonly text: string;
}

export interface AdminSemanticDiffSummary {
  readonly changes: readonly {
    readonly category: string;
    readonly evidence: readonly string[];
    readonly summary: string;
  }[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly model?: string | undefined;
  readonly summary: string;
}

export interface AdminKnowledgeFsDiff {
  readonly mode: AdminKnowledgeFsDiffMode;
  readonly newPath: string;
  readonly oldPath: string;
  readonly operations: readonly AdminTextDiffOperation[];
  readonly semantic?: AdminSemanticDiffSummary | undefined;
  readonly stats: {
    readonly delete: number;
    readonly equal: number;
    readonly insert: number;
  };
}

export interface AdminKnowledgeFsWrite {
  readonly bytesWritten: number;
  readonly mode: "append" | "write";
  readonly objectKey: string;
  readonly path: string;
  readonly targetId: string;
  readonly version: number;
}

export interface AdminSseEvent {
  readonly data: unknown;
  readonly event: string;
}

export interface AdminAnswerTraceStep {
  readonly endedAt?: string | undefined;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly startedAt: string;
  readonly status: "error" | "ok" | "skipped";
}

export interface AdminAnswerTrace {
  readonly createdAt: string;
  readonly evidenceBundleId?: string | undefined;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly mode: "auto" | "deep" | "fast" | "research";
  readonly query: string;
  readonly steps: readonly AdminAnswerTraceStep[];
}

export interface GetAnswerTraceInput {
  readonly token: string;
  readonly traceId: string;
}

export interface ListQueryVirtualEntriesInput extends GetAnswerTraceInput {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface AdminApiClient {
  annotateGoldenQuestion(input: AnnotateGoldenQuestionInput): Promise<AdminGoldenQuestion>;
  captureProductionBadCase(input: CaptureProductionBadCaseInput): Promise<AdminGoldenQuestion>;
  createGoldenQuestion(input: CreateGoldenQuestionInput): Promise<AdminGoldenQuestion>;
  deleteGoldenQuestion(input: DeleteGoldenQuestionInput): Promise<boolean>;
  catKnowledgeFs(input: ReadKnowledgeFsInput): Promise<AdminKnowledgeFsCat>;
  diffKnowledgeFs(input: DiffKnowledgeFsInput): Promise<AdminKnowledgeFsDiff>;
  executeStagedObjectGc(
    input: ExecuteKnowledgeFsStagedObjectGcInput,
  ): Promise<AdminKnowledgeFsStagedObjectGcExecuteResult>;
  getAnswerTrace(input: GetAnswerTraceInput): Promise<AdminAnswerTrace>;
  getDocument(input: GetDocumentInput): Promise<AdminDocumentAsset>;
  getDocumentMultimodalAsset(
    input: GetDocumentMultimodalAssetInput,
  ): Promise<AdminDocumentMultimodalAsset>;
  getDocumentMultimodalManifest(input: GetDocumentInput): Promise<AdminDocumentMultimodalManifest>;
  getDocumentOutline(input: GetDocumentInput): Promise<AdminDocumentOutline>;
  getGoldenQuestion(input: GetGoldenQuestionInput): Promise<AdminGoldenQuestion>;
  getKnowledgeSpaceManifest(
    input: GetKnowledgeSpaceControlPlaneInput,
  ): Promise<AdminKnowledgeSpaceManifest>;
  getKnowledgeSpaceStatus(
    input: GetKnowledgeSpaceControlPlaneInput,
  ): Promise<AdminKnowledgeSpaceStatus>;
  getKnowledgeFsck(input: GetKnowledgeFsckInput): Promise<AdminKnowledgeFsckReport>;
  getStagedObjectGcDryRun(
    input: GetKnowledgeFsStagedObjectGcInput,
  ): Promise<AdminKnowledgeFsGcDryRunReport>;
  getParseArtifact(input: GetParseArtifactInput): Promise<AdminParseArtifact>;
  health(): Promise<AdminHealthStatus>;
  listActiveLeases(input: ListKnowledgeSpaceDiagnosticsInput): Promise<AdminKnowledgeFsLeaseList>;
  listDocuments(input: ListDocumentsInput): Promise<AdminDocumentAssetList>;
  findKnowledgeFs(input: FindKnowledgeFsInput): Promise<AdminKnowledgeFsList>;
  grepKnowledgeFs(input: GrepKnowledgeFsInput): Promise<AdminKnowledgeFsGrep>;
  listGoldenQuestions(input: ListGoldenQuestionsInput): Promise<AdminGoldenQuestionList>;
  listKnowledgeFs(input: ListKnowledgeFsInput): Promise<AdminKnowledgeFsList>;
  listKnowledgeSpaces(input: ListKnowledgeSpacesInput): Promise<AdminKnowledgeSpaceList>;
  listStagedCommits(
    input: ListKnowledgeSpaceDiagnosticsInput,
  ): Promise<AdminKnowledgeSpaceStagedCommitList>;
  listQueryConflicts(input: ListQueryVirtualEntriesInput): Promise<AdminKnowledgeFsList>;
  listQueryEvidence(input: ListQueryVirtualEntriesInput): Promise<AdminKnowledgeFsList>;
  listQueryMissing(input: ListQueryVirtualEntriesInput): Promise<AdminKnowledgeFsList>;
  listSemanticView(input: ListSemanticViewInput): Promise<AdminKnowledgeFsList>;
  openKnowledgeFsNode(input: OpenKnowledgeFsNodeInput): Promise<AdminKnowledgeFsOpenNode>;
  statKnowledgeFs(input: ReadKnowledgeFsInput): Promise<AdminKnowledgeFsStat>;
  writeKnowledgeFs(input: WriteKnowledgeFsInput): Promise<AdminKnowledgeFsWrite>;
  appendKnowledgeFs(input: WriteKnowledgeFsInput): Promise<AdminKnowledgeFsWrite>;
  materializeSemanticTopicView(
    input: MaterializeSemanticTopicViewInput,
  ): Promise<AdminSemanticTopicMaterializationResult>;
  materializeSemanticCommunities(
    input: MaterializeSemanticCommunitiesInput,
  ): Promise<AdminSemanticCommunityMaterializationResult>;
  streamQuery(input: StreamQueryInput): Promise<AdminSseEvent[]>;
  treeKnowledgeFs(input: TreeKnowledgeFsInput): Promise<AdminKnowledgeFsTree>;
  traverseGraph(input: TraverseGraphInput): Promise<AdminGraphTraversal>;
  updateGoldenQuestion(input: UpdateGoldenQuestionInput): Promise<AdminGoldenQuestion>;
  uploadDocument(input: UploadDocumentInput): Promise<AdminDocumentAsset>;
  extractSemanticEntities(
    input: ExtractSemanticEntitiesInput,
  ): Promise<AdminSemanticEntityExtractionResult>;
}

const defaultMaxListLimit = 100;
const defaultMaxGraphDepth = 2;
const defaultMaxGraphFanout = 50;
const defaultMaxGraphNodes = 200;
const defaultMaxGraphTimeoutMs = 5_000;
const defaultMaxJsonBytes = 1024 * 1024;
const defaultMaxQueryBytes = 4_000;
const defaultMaxSseBytes = 1024 * 1024;
const defaultMaxUploadBytes = 10 * 1024 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const defaultLocalApiBaseUrl = "http://localhost:8788";

export function getAdminApiBase(): string {
  return (
    readNonEmptyEnv("KNOWLEDGE_API_BASE_URL") ??
    readNonEmptyEnv("NEXT_PUBLIC_API_BASE_URL") ??
    defaultLocalApiBaseUrl
  );
}

export function getAdminPublicApiBase(): string {
  return (
    readNonEmptyEnv("NEXT_PUBLIC_API_BASE_URL") ??
    readNonEmptyEnv("KNOWLEDGE_API_BASE_URL") ??
    defaultLocalApiBaseUrl
  );
}

function readNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function createAdminApiClient({
  baseUrl,
  fetch: fetchImpl = fetch,
  maxAssetBytes = defaultMaxUploadBytes,
  maxListLimit = defaultMaxListLimit,
  maxGraphDepth = defaultMaxGraphDepth,
  maxGraphFanout = defaultMaxGraphFanout,
  maxGraphNodes = defaultMaxGraphNodes,
  maxGraphTimeoutMs = defaultMaxGraphTimeoutMs,
  maxJsonBytes = defaultMaxJsonBytes,
  maxQueryBytes = defaultMaxQueryBytes,
  maxSseBytes = defaultMaxSseBytes,
  maxUploadBytes = defaultMaxUploadBytes,
}: AdminApiClientOptions): AdminApiClient {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (!Number.isInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("Admin API maxListLimit must be at least 1");
  }

  if (!Number.isInteger(maxGraphDepth) || maxGraphDepth < 1) {
    throw new Error("Admin API maxGraphDepth must be at least 1");
  }

  if (!Number.isInteger(maxGraphFanout) || maxGraphFanout < 1) {
    throw new Error("Admin API maxGraphFanout must be at least 1");
  }

  if (!Number.isInteger(maxGraphNodes) || maxGraphNodes < 1) {
    throw new Error("Admin API maxGraphNodes must be at least 1");
  }

  if (!Number.isInteger(maxGraphTimeoutMs) || maxGraphTimeoutMs < 1) {
    throw new Error("Admin API maxGraphTimeoutMs must be at least 1");
  }

  if (!Number.isInteger(maxJsonBytes) || maxJsonBytes < 1) {
    throw new Error("Admin API maxJsonBytes must be at least 1");
  }

  if (!Number.isInteger(maxAssetBytes) || maxAssetBytes < 1) {
    throw new Error("Admin API maxAssetBytes must be at least 1");
  }

  if (!Number.isInteger(maxQueryBytes) || maxQueryBytes < 1) {
    throw new Error("Admin API maxQueryBytes must be at least 1");
  }

  if (!Number.isInteger(maxSseBytes) || maxSseBytes < 1) {
    throw new Error("Admin API maxSseBytes must be at least 1");
  }

  if (!Number.isInteger(maxUploadBytes) || maxUploadBytes < 1) {
    throw new Error("Admin API maxUploadBytes must be at least 1");
  }

  const readJson = (response: Response) => readJsonResponse(response, maxJsonBytes);

  return {
    async annotateGoldenQuestion(input) {
      validateGoldenQuestionAnnotation(input);

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/golden-questions/${encodePathSegment(input.questionId)}/annotations`,
            normalizedBaseUrl,
          ),
          {
            body: JSON.stringify({
              answerCorrectness: input.answerCorrectness,
              evidenceRelevance: input.evidenceRelevance.map((item) => ({
                evidenceId: item.evidenceId,
                ...(item.note ? { note: item.note } : {}),
                relevant: item.relevant,
              })),
              ...(input.note ? { note: input.note } : {}),
            }),
            headers: {
              ...authHeaders(input.token),
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      );

      return parseGoldenQuestion(await readJson(response));
    },
    async captureProductionBadCase(input) {
      validateProductionBadCaseCapture(input);

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/production-bad-cases`,
            normalizedBaseUrl,
          ),
          {
            body: JSON.stringify({
              ...(input.reason ? { reason: input.reason } : {}),
              tags: [...(input.tags ?? [])],
              traceId: input.traceId,
            }),
            headers: {
              ...authHeaders(input.token),
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      );

      return parseGoldenQuestion(await readJson(response));
    },
    async createGoldenQuestion(input) {
      validateGoldenQuestionMutation(input);

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/golden-questions`,
            normalizedBaseUrl,
          ),
          {
            body: JSON.stringify({
              expectedEvidenceIds: [...(input.expectedEvidenceIds ?? [])],
              metadata: input.metadata ? { ...input.metadata } : {},
              question: input.question,
              tags: [...(input.tags ?? [])],
            }),
            headers: {
              ...authHeaders(input.token),
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      );

      return parseGoldenQuestion(await readJson(response));
    },
    async deleteGoldenQuestion(input) {
      validateGoldenQuestionLookup(input);

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/golden-questions/${encodePathSegment(input.questionId)}`,
            normalizedBaseUrl,
          ),
          {
            headers: authHeaders(input.token),
            method: "DELETE",
          },
        ),
      );

      if (!response.ok) {
        throw new Error(`Admin API request failed with status ${response.status}`);
      }

      return response.status === 204;
    },
    async catKnowledgeFs(input) {
      validateToken(input.token);
      validateKnowledgeFsPathInput(input.path);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/fs/cat`,
        normalizedBaseUrl,
      );
      url.searchParams.set("path", input.path);

      if (input.limit !== undefined) {
        url.searchParams.set("limit", String(input.limit));
      }

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeFsCat(await readJson(response));
    },
    async diffKnowledgeFs(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      validateKnowledgeFsPathInput(input.oldPath, "diff paths");
      validateKnowledgeFsPathInput(input.newPath, "diff paths");

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/fs/diff`,
        normalizedBaseUrl,
      );
      url.searchParams.set("oldPath", input.oldPath);
      url.searchParams.set("newPath", input.newPath);

      if (input.mode) {
        url.searchParams.set("mode", input.mode);
      }

      if (input.semantic === true) {
        url.searchParams.set("semantic", "true");
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeFsDiff(await readJson(response));
    },
    async executeStagedObjectGc(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);
      validateId("dryRunId", input.dryRunId);
      validateId("idempotencyKey", input.idempotencyKey);

      if (input.candidates.length < 1) {
        throw new Error("Admin API staged-object GC execution requires at least one candidate");
      }

      if (
        !input.candidates.some((candidate) => candidate.idempotencyKey === input.idempotencyKey)
      ) {
        throw new Error("Admin API staged-object GC idempotency key must match a candidate");
      }

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/gc/staged-objects/execute`,
            normalizedBaseUrl,
          ),
          {
            body: JSON.stringify({ candidates: input.candidates }),
            headers: {
              ...authHeaders(input.token),
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      );

      return parseStagedObjectGcExecuteResult(await readJson(response));
    },
    async extractSemanticEntities(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      if (
        input.limit !== undefined &&
        (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit)
      ) {
        throw new Error(
          `Admin API semantic entity extraction limit must be between 1 and ${maxListLimit}`,
        );
      }

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/semantic-views/entities/extract`,
            normalizedBaseUrl,
          ),
          {
            body: JSON.stringify({ ...(input.limit ? { limit: input.limit } : {}) }),
            headers: {
              ...authHeaders(input.token),
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      );

      return parseSemanticEntityExtractionResult(await readJson(response));
    },
    async getAnswerTrace(input) {
      validateTraceLookup(input);

      const response = await fetchImpl(
        new Request(new URL(`/queries/${encodePathSegment(input.traceId)}`, normalizedBaseUrl), {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseAnswerTrace(await readJson(response));
    },
    async getDocument(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);
      validateId("documentId", input.documentId);

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/documents/${encodePathSegment(input.documentId)}`,
            normalizedBaseUrl,
          ),
          {
            headers: authHeaders(input.token),
            method: "GET",
          },
        ),
      );

      return parseDocumentAsset(await readJson(response));
    },
    async getDocumentOutline(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);
      validateId("documentId", input.documentId);

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/documents/${encodePathSegment(input.documentId)}/outline`,
            normalizedBaseUrl,
          ),
          {
            headers: authHeaders(input.token),
            method: "GET",
          },
        ),
      );

      return parseDocumentOutline(await readJson(response));
    },
    async getDocumentMultimodalManifest(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);
      validateId("documentId", input.documentId);

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/documents/${encodePathSegment(input.documentId)}/multimodal`,
            normalizedBaseUrl,
          ),
          {
            headers: authHeaders(input.token),
            method: "GET",
          },
        ),
      );

      return parseDocumentMultimodalManifest(await readJson(response));
    },
    async getDocumentMultimodalAsset(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);
      validateId("documentId", input.documentId);

      if (!input.itemId.trim()) {
        throw new Error("Admin API document multimodal itemId must not be empty");
      }

      if (input.variant !== undefined && !input.variant.trim()) {
        throw new Error("Admin API document multimodal asset variant must not be empty");
      }

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/documents/${encodePathSegment(input.documentId)}/multimodal/${encodePathSegment(input.itemId)}/asset`,
        normalizedBaseUrl,
      );

      if (input.variant !== undefined) {
        url.searchParams.set("variant", input.variant);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return readDocumentMultimodalAssetResponse(response, maxAssetBytes);
    },
    async listDocuments(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit) {
        throw new Error(`Admin API document list limit must be between 1 and ${maxListLimit}`);
      }

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/documents`,
        normalizedBaseUrl,
      );
      url.searchParams.set("limit", String(input.limit));

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseDocumentAssetList(await readJson(response));
    },
    async getGoldenQuestion(input) {
      validateGoldenQuestionLookup(input);

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/golden-questions/${encodePathSegment(input.questionId)}`,
            normalizedBaseUrl,
          ),
          {
            headers: authHeaders(input.token),
            method: "GET",
          },
        ),
      );

      return parseGoldenQuestion(await readJson(response));
    },
    async getKnowledgeSpaceManifest(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/manifest`,
            normalizedBaseUrl,
          ),
          {
            headers: authHeaders(input.token),
            method: "GET",
          },
        ),
      );

      return parseKnowledgeSpaceManifest(await readJson(response));
    },
    async getKnowledgeSpaceStatus(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/status`,
            normalizedBaseUrl,
          ),
          {
            headers: authHeaders(input.token),
            method: "GET",
          },
        ),
      );

      return parseKnowledgeSpaceStatus(await readJson(response));
    },
    async getKnowledgeFsck(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/fsck`,
        normalizedBaseUrl,
      );
      url.searchParams.set("check", input.check);

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeFsckReport(await readJson(response));
    },
    async getStagedObjectGcDryRun(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/gc/staged-objects`,
        normalizedBaseUrl,
      );

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseStagedObjectGcDryRunReport(await readJson(response));
    },
    async getParseArtifact(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);
      validateId("documentId", input.documentId);

      if (!Number.isInteger(input.version) || input.version < 1) {
        throw new Error("Admin API parse artifact version must be at least 1");
      }

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/documents/${encodePathSegment(input.documentId)}/parse-artifacts/${input.version}`,
            normalizedBaseUrl,
          ),
          {
            headers: authHeaders(input.token),
            method: "GET",
          },
        ),
      );

      return parseParseArtifact(await readJson(response));
    },
    async health() {
      const response = await fetchImpl(new URL("/health", normalizedBaseUrl));
      return parseHealthStatus(await readJson(response));
    },
    async listActiveLeases(input) {
      validateKnowledgeSpaceDiagnosticsList(input, maxListLimit);

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/leases/active`,
        normalizedBaseUrl,
      );
      url.searchParams.set("limit", String(input.limit));

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeFsLeaseList(await readJson(response));
    },
    async listGoldenQuestions(input) {
      validateGoldenQuestionList(input, maxListLimit);

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/golden-questions`,
        normalizedBaseUrl,
      );
      url.searchParams.set("limit", String(input.limit));

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseGoldenQuestionList(await readJson(response));
    },
    async listKnowledgeFs(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      validateKnowledgeFsPathInput(input.path);

      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit) {
        throw new Error(`Admin API KnowledgeFS list limit must be between 1 and ${maxListLimit}`);
      }

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/fs/ls`,
        normalizedBaseUrl,
      );
      url.searchParams.set("path", input.path);
      url.searchParams.set("limit", String(input.limit));

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeFsList(await readJson(response));
    },
    async treeKnowledgeFs(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);
      validateKnowledgeFsPathInput(input.path);

      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit) {
        throw new Error(`Admin API KnowledgeFS list limit must be between 1 and ${maxListLimit}`);
      }

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/fs/tree`,
        normalizedBaseUrl,
      );
      url.searchParams.set("path", input.path);
      url.searchParams.set("limit", String(input.limit));

      if (input.depth !== undefined) {
        url.searchParams.set("depth", String(input.depth));
      }

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeFsTree(await readJson(response));
    },
    async grepKnowledgeFs(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);
      validateKnowledgeFsPathInput(input.path);

      if (!input.q.trim()) {
        throw new Error("Admin API KnowledgeFS grep query is required");
      }

      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit) {
        throw new Error(`Admin API KnowledgeFS list limit must be between 1 and ${maxListLimit}`);
      }

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/fs/grep`,
        normalizedBaseUrl,
      );
      url.searchParams.set("path", input.path);
      url.searchParams.set("limit", String(input.limit));
      url.searchParams.set("q", input.q);

      if (input.timeoutMs !== undefined) {
        url.searchParams.set("timeoutMs", String(input.timeoutMs));
      }

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeFsGrep(await readJson(response));
    },
    async findKnowledgeFs(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);
      validateKnowledgeFsPathInput(input.path);

      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit) {
        throw new Error(`Admin API KnowledgeFS list limit must be between 1 and ${maxListLimit}`);
      }

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/fs/find`,
        normalizedBaseUrl,
      );
      url.searchParams.set("path", input.path);
      url.searchParams.set("limit", String(input.limit));

      if (input.nameContains) {
        url.searchParams.set("nameContains", input.nameContains);
      }

      if (input.resourceType) {
        url.searchParams.set("resourceType", input.resourceType);
      }

      if (input.metadataKey) {
        url.searchParams.set("metadataKey", input.metadataKey);
      }

      if (input.metadataValue) {
        url.searchParams.set("metadataValue", input.metadataValue);
      }

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeFsList(await readJson(response));
    },
    async listSemanticView(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit) {
        throw new Error(`Admin API KnowledgeFS list limit must be between 1 and ${maxListLimit}`);
      }

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/fs/ls`,
        normalizedBaseUrl,
      );
      url.searchParams.set("path", semanticViewPath(input.view, input.key));
      url.searchParams.set("limit", String(input.limit));

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeFsList(await readJson(response));
    },
    async materializeSemanticTopicView(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      if (
        input.limit !== undefined &&
        (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit)
      ) {
        throw new Error(
          `Admin API semantic topic materialization limit must be between 1 and ${maxListLimit}`,
        );
      }

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/semantic-views/topic/materialize`,
            normalizedBaseUrl,
          ),
          {
            body: JSON.stringify({
              ...(input.generatedVersion ? { generatedVersion: input.generatedVersion } : {}),
              ...(input.limit ? { limit: input.limit } : {}),
              ...(input.topicName ? { topicName: input.topicName } : {}),
              ...(input.topicSlug ? { topicSlug: input.topicSlug } : {}),
            }),
            headers: {
              ...authHeaders(input.token),
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      );

      return parseSemanticTopicMaterializationResult(await readJson(response));
    },
    async materializeSemanticCommunities(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/semantic-views/communities/materialize`,
            normalizedBaseUrl,
          ),
          {
            body: JSON.stringify({
              ...(input.generatedVersion ? { generatedVersion: input.generatedVersion } : {}),
            }),
            headers: {
              ...authHeaders(input.token),
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      );

      return parseSemanticCommunityMaterializationResult(await readJson(response));
    },
    async listKnowledgeSpaces(input) {
      validateToken(input.token);

      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit) {
        throw new Error(
          `Admin API listKnowledgeSpaces limit must be between 1 and ${maxListLimit}`,
        );
      }

      const url = new URL("/knowledge-spaces", normalizedBaseUrl);
      url.searchParams.set("limit", String(input.limit));

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeSpaceList(await readJson(response));
    },
    async listStagedCommits(input) {
      validateKnowledgeSpaceDiagnosticsList(input, maxListLimit);

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/staged-commits`,
        normalizedBaseUrl,
      );
      url.searchParams.set("limit", String(input.limit));

      if (input.cursor) {
        url.searchParams.set("cursor", input.cursor);
      }

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeSpaceStagedCommitList(await readJson(response));
    },
    async listQueryConflicts(input) {
      return listQueryVirtualEntries({
        input,
        normalizedBaseUrl,
        readJson,
        fetchImpl,
        segment: "conflicts",
      });
    },
    async listQueryEvidence(input) {
      return listQueryVirtualEntries({
        input,
        normalizedBaseUrl,
        readJson,
        fetchImpl,
        segment: "evidence",
      });
    },
    async listQueryMissing(input) {
      return listQueryVirtualEntries({
        input,
        normalizedBaseUrl,
        readJson,
        fetchImpl,
        segment: "missing",
      });
    },
    async openKnowledgeFsNode(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);
      validateId("nodeId", input.nodeId);

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/fs/open_node`,
        normalizedBaseUrl,
      );
      url.searchParams.set("nodeId", input.nodeId);

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeFsOpenNode(await readJson(response));
    },
    async statKnowledgeFs(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);
      validateKnowledgeFsPathInput(input.path);

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/fs/stat`,
        normalizedBaseUrl,
      );
      url.searchParams.set("path", input.path);

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseKnowledgeFsStat(await readJson(response));
    },
    async writeKnowledgeFs(input) {
      return executeKnowledgeFsWrite({
        input,
        normalizedBaseUrl,
        readJson,
        fetchImpl,
        command: "write",
      });
    },
    async appendKnowledgeFs(input) {
      return executeKnowledgeFsWrite({
        input,
        normalizedBaseUrl,
        readJson,
        fetchImpl,
        command: "append",
      });
    },
    async streamQuery(input) {
      validateToken(input.token);

      if (!input.knowledgeSpaceId.trim()) {
        throw new Error("Admin API knowledgeSpaceId is required");
      }

      if (!input.query.trim()) {
        throw new Error("Admin API query is required");
      }

      if (textEncoder.encode(input.query).byteLength > maxQueryBytes) {
        throw new Error(`Admin API query exceeds maxQueryBytes=${maxQueryBytes}`);
      }

      const response = await fetchImpl(
        new Request(new URL("/queries", normalizedBaseUrl), {
          body: JSON.stringify({
            knowledgeSpaceId: input.knowledgeSpaceId,
            ...(input.mode ? { mode: input.mode } : {}),
            query: input.query,
          }),
          headers: {
            ...authHeaders(input.token),
            "content-type": "application/json",
          },
          method: "POST",
        }),
      );

      if (!response.ok) {
        throw new Error(`Admin API request failed with status ${response.status}`);
      }

      return parseSseEvents(await readBoundedTextResponse(response, maxSseBytes));
    },
    async updateGoldenQuestion(input) {
      validateGoldenQuestionLookup(input);

      if (input.question !== undefined && !input.question.trim()) {
        throw new Error("Admin API golden question is required");
      }

      const body: Record<string, unknown> = {};
      if (input.expectedEvidenceIds !== undefined) {
        body.expectedEvidenceIds = [...input.expectedEvidenceIds];
      }
      if (input.metadata !== undefined) {
        body.metadata = { ...input.metadata };
      }
      if (input.question !== undefined) {
        body.question = input.question;
      }
      if (input.tags !== undefined) {
        body.tags = [...input.tags];
      }

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/golden-questions/${encodePathSegment(input.questionId)}`,
            normalizedBaseUrl,
          ),
          {
            body: JSON.stringify(body),
            headers: {
              ...authHeaders(input.token),
              "content-type": "application/json",
            },
            method: "PATCH",
          },
        ),
      );

      return parseGoldenQuestion(await readJson(response));
    },
    async traverseGraph(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);
      validateId("entityId", input.entityId);

      const depth = input.depth ?? maxGraphDepth;
      const fanout = input.fanout ?? Math.min(20, maxGraphFanout);
      const maxNodes = input.maxNodes ?? Math.min(50, maxGraphNodes);
      const timeoutMs = input.timeoutMs ?? Math.min(250, maxGraphTimeoutMs);

      validateIntegerRange("graph depth", depth, 1, maxGraphDepth);
      validateIntegerRange("graph fanout", fanout, 1, maxGraphFanout);
      validateIntegerRange("graph maxNodes", maxNodes, 1, maxGraphNodes);
      validateIntegerRange("graph timeoutMs", timeoutMs, 1, maxGraphTimeoutMs);

      const url = new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/graph/traverse`,
        normalizedBaseUrl,
      );
      url.searchParams.set("entityId", input.entityId);
      url.searchParams.set("depth", String(depth));
      url.searchParams.set("fanout", String(fanout));
      url.searchParams.set("maxNodes", String(maxNodes));
      url.searchParams.set("timeoutMs", String(timeoutMs));

      const response = await fetchImpl(
        new Request(url, {
          headers: authHeaders(input.token),
          method: "GET",
        }),
      );

      return parseGraphTraversal(await readJson(response));
    },
    async uploadDocument(input) {
      validateToken(input.token);
      validateId("knowledgeSpaceId", input.knowledgeSpaceId);

      if (input.file.size > maxUploadBytes) {
        throw new Error(`Admin API upload exceeds maxUploadBytes=${maxUploadBytes}`);
      }

      const formData = new FormData();
      formData.set("file", input.file);
      if (input.sourceId) {
        formData.set("sourceId", input.sourceId);
      }

      const response = await fetchImpl(
        new Request(
          new URL(
            `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/documents`,
            normalizedBaseUrl,
          ),
          {
            body: formData,
            headers: authHeaders(input.token),
            method: "POST",
          },
        ),
      );

      return parseDocumentAsset(await readJson(response));
    },
  };
}

async function executeKnowledgeFsWrite({
  command,
  fetchImpl,
  input,
  normalizedBaseUrl,
  readJson,
}: {
  readonly command: "append" | "write";
  readonly fetchImpl: typeof fetch;
  readonly input: WriteKnowledgeFsInput;
  readonly normalizedBaseUrl: URL;
  readonly readJson: (response: Response) => Promise<unknown>;
}): Promise<AdminKnowledgeFsWrite> {
  validateToken(input.token);
  validateId("knowledgeSpaceId", input.knowledgeSpaceId);
  validateKnowledgeFsPathInput(input.path);

  if (textEncoder.encode(input.text).byteLength > 256 * 1024) {
    throw new Error("Admin API KnowledgeFS write text exceeds 256 KiB");
  }

  const response = await fetchImpl(
    new Request(
      new URL(
        `/knowledge-spaces/${encodePathSegment(input.knowledgeSpaceId)}/fs/${command}`,
        normalizedBaseUrl,
      ),
      {
        body: JSON.stringify({
          path: input.path,
          text: input.text,
        }),
        headers: {
          ...authHeaders(input.token),
          "content-type": "application/json",
        },
        method: "POST",
      },
    ),
  );

  return parseKnowledgeFsWrite(await readJson(response));
}

async function listQueryVirtualEntries({
  fetchImpl,
  input,
  normalizedBaseUrl,
  readJson,
  segment,
}: {
  readonly fetchImpl: typeof fetch;
  readonly input: ListQueryVirtualEntriesInput;
  readonly normalizedBaseUrl: URL;
  readonly readJson: (response: Response) => Promise<unknown>;
  readonly segment: "conflicts" | "evidence" | "missing";
}): Promise<AdminKnowledgeFsList> {
  validateTraceLookup(input);

  if (!Number.isInteger(input.limit) || input.limit < 1) {
    throw new Error("Admin API query virtual entry limit must be at least 1");
  }

  const url = new URL(`/queries/${encodePathSegment(input.traceId)}/${segment}`, normalizedBaseUrl);
  url.searchParams.set("limit", String(input.limit));

  if (input.cursor) {
    url.searchParams.set("cursor", input.cursor);
  }

  const response = await fetchImpl(
    new Request(url, {
      headers: authHeaders(input.token),
      method: "GET",
    }),
  );

  return parseKnowledgeFsList(await readJson(response));
}

export function parseSseEvents(payload: string): AdminSseEvent[] {
  const events: AdminSseEvent[] = [];

  for (const block of payload.split(/\n\n+/u)) {
    const trimmed = block.trim();

    if (!trimmed) {
      continue;
    }

    let event = "message";
    const dataLines: string[] = [];

    for (const line of trimmed.split(/\n/u)) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
        continue;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    const dataText = dataLines.join("\n");

    try {
      events.push({
        data: dataText ? JSON.parse(dataText) : null,
        event,
      });
    } catch (error) {
      throw new Error("Admin API SSE event contains invalid JSON", { cause: error });
    }
  }

  return events;
}

function normalizeBaseUrl(baseUrl: string): URL {
  const trimmed = baseUrl.trim();

  if (!trimmed) {
    throw new Error("Admin API baseUrl is required");
  }

  return new URL(trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
}

function validateToken(token: string): void {
  if (!token.trim()) {
    throw new Error("Admin API token is required");
  }
}

function validateId(label: string, value: string): void {
  if (!value.trim()) {
    throw new Error(`Admin API ${label} is required`);
  }
}

function validateKnowledgeFsPathInput(path: string, label = "path"): void {
  if (!path.trim().startsWith("/")) {
    throw new Error(`Admin API KnowledgeFS ${label} must be absolute`);
  }
}

function validateUuid(label: string, value: string): void {
  validateId(label, value);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Admin API ${label} must be a UUID`);
  }
}

function validateGoldenQuestionList(input: ListGoldenQuestionsInput, maxListLimit: number): void {
  validateToken(input.token);
  validateId("knowledgeSpaceId", input.knowledgeSpaceId);

  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit) {
    throw new Error(`Admin API golden question list limit must be between 1 and ${maxListLimit}`);
  }
}

function validateKnowledgeSpaceDiagnosticsList(
  input: ListKnowledgeSpaceDiagnosticsInput,
  maxListLimit: number,
): void {
  validateToken(input.token);
  validateId("knowledgeSpaceId", input.knowledgeSpaceId);

  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit) {
    throw new Error(
      `Admin API KnowledgeSpace diagnostics list limit must be between 1 and ${maxListLimit}`,
    );
  }
}

function validateGoldenQuestionLookup(input: GetGoldenQuestionInput): void {
  validateToken(input.token);
  validateId("knowledgeSpaceId", input.knowledgeSpaceId);
  validateId("questionId", input.questionId);
}

function validateGoldenQuestionMutation(input: CreateGoldenQuestionInput): void {
  validateToken(input.token);
  validateId("knowledgeSpaceId", input.knowledgeSpaceId);

  if (!input.question.trim()) {
    throw new Error("Admin API golden question is required");
  }

  for (const id of input.expectedEvidenceIds ?? []) {
    validateUuid("expectedEvidenceId", id);
  }
}

function validateGoldenQuestionAnnotation(input: AnnotateGoldenQuestionInput): void {
  validateGoldenQuestionLookup(input);

  if (
    !["correct", "incorrect", "not-answerable", "partially-correct"].includes(
      input.answerCorrectness,
    )
  ) {
    throw new Error("Admin API answerCorrectness is invalid");
  }

  if (input.evidenceRelevance.length > 50) {
    throw new Error("Admin API annotation evidenceRelevance cannot exceed 50 items");
  }

  for (const item of input.evidenceRelevance) {
    validateUuid("evidenceId", item.evidenceId);

    if (item.note !== undefined && !item.note.trim()) {
      throw new Error("Admin API annotation evidence note must not be empty");
    }
  }

  if (input.note !== undefined && !input.note.trim()) {
    throw new Error("Admin API annotation note must not be empty");
  }
}

function validateProductionBadCaseCapture(input: CaptureProductionBadCaseInput): void {
  validateToken(input.token);
  validateId("knowledgeSpaceId", input.knowledgeSpaceId);
  validateUuid("traceId", input.traceId);

  if (input.reason !== undefined && !input.reason.trim()) {
    throw new Error("Admin API bad-case reason must not be empty");
  }
}

function validateTraceLookup(input: GetAnswerTraceInput): void {
  validateToken(input.token);
  validateUuid("traceId", input.traceId);
}

function validateIntegerRange(label: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Admin API ${label} must be between ${min} and ${max}`);
  }
}

function semanticViewPath(view: AdminSemanticView, key: string | undefined): string {
  const basePath = `/knowledge/${view}`;

  if (key === undefined || key.trim() === "") {
    return basePath;
  }

  const trimmed = key.trim();
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new Error("Admin API semantic view key must be a single path segment");
  }

  return `${basePath}/${trimmed}`;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
  };
}

async function readJsonResponse(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.ok) {
    const message = extractApiErrorMessage(
      await readBoundedTextResponse(response, maxBytes, "JSON"),
    );
    throw new Error(
      message
        ? `Admin API request failed with status ${response.status}: ${message}`
        : `Admin API request failed with status ${response.status}`,
    );
  }

  const text = await readBoundedTextResponse(response, maxBytes, "JSON");

  return JSON.parse(text) as unknown;
}

async function readDocumentMultimodalAssetResponse(
  response: Response,
  maxBytes: number,
): Promise<AdminDocumentMultimodalAsset> {
  if (!response.ok) {
    const message = extractApiErrorMessage(
      await readBoundedTextResponse(response, defaultMaxJsonBytes, "JSON"),
    );
    throw new Error(
      message
        ? `Admin API request failed with status ${response.status}: ${message}`
        : `Admin API request failed with status ${response.status}`,
    );
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new Error(`Admin API multimodal asset response exceeds maxAssetBytes=${maxBytes}`);
    }
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Admin API multimodal asset response exceeds maxAssetBytes=${maxBytes}`);
  }

  return {
    bytes,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    ...(response.headers.get("x-document-multimodal-item-id")
      ? { itemId: response.headers.get("x-document-multimodal-item-id") ?? undefined }
      : {}),
  };
}

function extractApiErrorMessage(text: string): string | undefined {
  if (!text.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof parsed.error === "string" &&
      parsed.error.trim()
    ) {
      return parsed.error.trim();
    }

    const issueMessage = extractZodIssueMessage(parsed);
    if (issueMessage) {
      return issueMessage;
    }
  } catch {
    return text.trim().slice(0, 500);
  }

  return undefined;
}

function extractZodIssueMessage(value: unknown): string | undefined {
  const directIssue = firstZodIssueMessage(value);
  if (directIssue) {
    return directIssue;
  }

  if (isRecord(value)) {
    const nestedIssue = firstZodIssueMessage(value.error);
    if (nestedIssue) {
      return nestedIssue;
    }
  }

  return undefined;
}

function firstZodIssueMessage(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.issues)) {
    return undefined;
  }

  const issue = value.issues.find(isRecord);
  if (!issue || typeof issue.message !== "string" || !issue.message.trim()) {
    return undefined;
  }

  const path = Array.isArray(issue.path)
    ? issue.path.filter((part) => typeof part === "string" || typeof part === "number").join(".")
    : "";

  return path ? `${path}: ${issue.message}` : issue.message.trim();
}

async function readBoundedTextResponse(
  response: Response,
  maxBytes: number,
  label = "SSE",
): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error(
        label === "JSON"
          ? `Admin API JSON response exceeds maxJsonBytes=${maxBytes}`
          : `Admin API SSE response exceeds maxSseBytes=${maxBytes}`,
      );
    }

    chunks.push(value.slice());
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return textDecoder.decode(merged);
}

function parseHealthStatus(value: unknown): AdminHealthStatus {
  if (!isRecord(value) || typeof value.ok !== "boolean" || !isRecord(value.components)) {
    throw new Error("Admin API health response is invalid");
  }

  if (value.runtime !== "cloudflare-workers" && value.runtime !== "node-docker") {
    throw new Error("Admin API health runtime is invalid");
  }

  const components: Record<string, boolean> = {};

  for (const [key, healthy] of Object.entries(value.components)) {
    if (typeof healthy !== "boolean") {
      throw new Error("Admin API health component value is invalid");
    }

    components[key] = healthy;
  }

  return {
    components,
    ok: value.ok,
    runtime: value.runtime,
  };
}

function parseKnowledgeSpaceList(value: unknown): AdminKnowledgeSpaceList {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("Admin API knowledge-space list response is invalid");
  }

  return {
    items: value.items.map(parseKnowledgeSpace),
    ...(typeof value.nextCursor === "string" ? { nextCursor: value.nextCursor } : {}),
  };
}

function parseKnowledgeSpace(value: unknown): AdminKnowledgeSpace {
  if (!isRecord(value)) {
    throw new Error("Admin API knowledge-space response item is invalid");
  }

  const required = ["createdAt", "id", "name", "slug", "tenantId", "updatedAt"] as const;

  for (const key of required) {
    if (typeof value[key] !== "string") {
      throw new Error(`Admin API knowledge-space ${key} is invalid`);
    }
  }

  const createdAt = value.createdAt;
  const id = value.id;
  const name = value.name;
  const slug = value.slug;
  const tenantId = value.tenantId;
  const updatedAt = value.updatedAt;

  if (
    typeof createdAt !== "string" ||
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof slug !== "string" ||
    typeof tenantId !== "string" ||
    typeof updatedAt !== "string"
  ) {
    throw new Error("Admin API knowledge-space response item is invalid");
  }

  return {
    createdAt,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    id,
    name,
    slug,
    tenantId,
    updatedAt,
  };
}

function parseKnowledgeSpaceManifest(value: unknown): AdminKnowledgeSpaceManifest {
  if (!isRecord(value)) {
    throw new Error("Admin API KnowledgeSpace manifest response is invalid");
  }

  if (
    typeof value.manifestVersion !== "number" ||
    typeof value.objectKeyPrefix !== "string" ||
    typeof value.parserPolicyVersion !== "string" ||
    typeof value.projectionSetVersion !== "string" ||
    typeof value.storageProvider !== "string" ||
    !isRecord(value.consistencyPolicy) ||
    !isRecord(value.quotaPolicy)
  ) {
    throw new Error("Admin API KnowledgeSpace manifest response is invalid");
  }

  return {
    consistencyPolicy: { ...value.consistencyPolicy },
    manifestVersion: value.manifestVersion,
    objectKeyPrefix: value.objectKeyPrefix,
    parserPolicyVersion: value.parserPolicyVersion,
    projectionSetVersion: value.projectionSetVersion,
    quotaPolicy: { ...value.quotaPolicy },
    storageProvider: value.storageProvider,
  };
}

function parseKnowledgeSpaceStatus(value: unknown): AdminKnowledgeSpaceStatus {
  if (!isRecord(value)) {
    throw new Error("Admin API KnowledgeSpace status response is invalid");
  }

  return {
    ...(isRecord(value.index) ? { index: { ...value.index } } : {}),
    ...(isRecord(value.manifest) ? { manifest: { ...value.manifest } } : {}),
    ...(isRecord(value.parser) ? { parser: { ...value.parser } } : {}),
    ...(isRecord(value.runtime) ? { runtime: { ...value.runtime } } : {}),
    ...(isRecord(value.storage) ? { storage: { ...value.storage } } : {}),
  };
}

function parseKnowledgeSpaceStagedCommitList(value: unknown): AdminKnowledgeSpaceStagedCommitList {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("Admin API staged commit diagnostic list response is invalid");
  }

  return {
    items: value.items.map(parseKnowledgeSpaceStagedCommit),
    ...(typeof value.nextCursor === "string" ? { nextCursor: value.nextCursor } : {}),
  };
}

function parseKnowledgeSpaceStagedCommit(value: unknown): AdminKnowledgeSpaceStagedCommit {
  if (!isRecord(value)) {
    throw new Error("Admin API staged commit diagnostic response item is invalid");
  }

  if (
    typeof value.id !== "string" ||
    typeof value.idempotencyKey !== "string" ||
    typeof value.operationType !== "string" ||
    typeof value.status !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error("Admin API staged commit diagnostic response item is invalid");
  }

  return {
    ...(typeof value.errorCode === "string" ? { errorCode: value.errorCode } : {}),
    ...(typeof value.errorMessage === "string" ? { errorMessage: value.errorMessage } : {}),
    ...(typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {}),
    id: value.id,
    idempotencyKey: value.idempotencyKey,
    operationType: value.operationType,
    status: value.status,
    updatedAt: value.updatedAt,
  };
}

function parseKnowledgeFsLeaseList(value: unknown): AdminKnowledgeFsLeaseList {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("Admin API active lease diagnostic list response is invalid");
  }

  return {
    items: value.items.map(parseKnowledgeFsLease),
    ...(typeof value.nextCursor === "string" ? { nextCursor: value.nextCursor } : {}),
  };
}

function parseKnowledgeFsLease(value: unknown): AdminKnowledgeFsLease {
  if (!isRecord(value)) {
    throw new Error("Admin API active lease diagnostic response item is invalid");
  }

  if (
    typeof value.expiresAt !== "string" ||
    typeof value.heartbeatAt !== "string" ||
    typeof value.id !== "string" ||
    typeof value.leaseType !== "string" ||
    typeof value.status !== "string" ||
    typeof value.targetId !== "string" ||
    typeof value.targetType !== "string" ||
    typeof value.virtualPath !== "string"
  ) {
    throw new Error("Admin API active lease diagnostic response item is invalid");
  }

  return {
    expiresAt: value.expiresAt,
    heartbeatAt: value.heartbeatAt,
    id: value.id,
    leaseType: value.leaseType,
    status: value.status,
    targetId: value.targetId,
    targetType: value.targetType,
    virtualPath: value.virtualPath,
  };
}

function parseKnowledgeFsckReport(value: unknown): AdminKnowledgeFsckReport {
  if (
    !isRecord(value) ||
    !Array.isArray(value.issues) ||
    typeof value.knowledgeSpaceId !== "string" ||
    typeof value.scannedAt !== "string" ||
    !isNumberRecord(value.summary) ||
    typeof value.tenantId !== "string"
  ) {
    throw new Error("Admin API fsck report response is invalid");
  }

  return {
    ...(typeof value.cursor === "string" ? { cursor: value.cursor } : {}),
    issues: value.issues.map(parseKnowledgeFsckIssue),
    knowledgeSpaceId: value.knowledgeSpaceId,
    scannedAt: value.scannedAt,
    summary: { ...value.summary },
    tenantId: value.tenantId,
  };
}

function parseKnowledgeFsckIssue(value: unknown): AdminKnowledgeFsckIssue {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    typeof value.repairability !== "string" ||
    typeof value.severity !== "string" ||
    !isRecord(value.target) ||
    typeof value.type !== "string"
  ) {
    throw new Error("Admin API fsck issue response item is invalid");
  }

  return {
    code: value.code,
    message: value.message,
    repairability: value.repairability,
    severity: value.severity,
    target: { ...value.target },
    type: value.type,
  };
}

function parseStagedObjectGcDryRunReport(value: unknown): AdminKnowledgeFsGcDryRunReport {
  if (
    !isRecord(value) ||
    !Array.isArray(value.candidates) ||
    typeof value.dryRunId !== "string" ||
    typeof value.generatedAt !== "string" ||
    typeof value.knowledgeSpaceId !== "string" ||
    !isNumberRecord(value.summary) ||
    typeof value.tenantId !== "string"
  ) {
    throw new Error("Admin API staged-object GC dry-run response is invalid");
  }

  return {
    candidates: value.candidates.map(parseGcCandidate),
    ...(typeof value.cursor === "string" ? { cursor: value.cursor } : {}),
    dryRunId: value.dryRunId,
    generatedAt: value.generatedAt,
    knowledgeSpaceId: value.knowledgeSpaceId,
    summary: { ...value.summary },
    tenantId: value.tenantId,
  };
}

function parseGcCandidate(value: unknown): AdminKnowledgeFsGcCandidate {
  if (
    !isRecord(value) ||
    typeof value.candidateType !== "string" ||
    typeof value.count !== "number" ||
    typeof value.estimatedBytes !== "number" ||
    typeof value.idempotencyKey !== "string" ||
    typeof value.reason !== "string" ||
    !isRecord(value.target)
  ) {
    throw new Error("Admin API GC candidate response item is invalid");
  }

  return {
    candidateType: value.candidateType,
    count: value.count,
    estimatedBytes: value.estimatedBytes,
    idempotencyKey: value.idempotencyKey,
    reason: value.reason,
    target: { ...value.target },
  };
}

function parseStagedObjectGcExecuteResult(
  value: unknown,
): AdminKnowledgeFsStagedObjectGcExecuteResult {
  if (
    !isRecord(value) ||
    typeof value.deleted !== "number" ||
    !Array.isArray(value.items) ||
    typeof value.skipped !== "number" ||
    typeof value.tenantId !== "string"
  ) {
    throw new Error("Admin API staged-object GC execute response is invalid");
  }

  return {
    deleted: value.deleted,
    items: value.items.map(parseStagedObjectGcExecuteItem),
    skipped: value.skipped,
    tenantId: value.tenantId,
  };
}

function parseStagedObjectGcExecuteItem(value: unknown): {
  readonly idempotencyKey: string;
  readonly objectKey: string;
  readonly status: string;
} {
  if (
    !isRecord(value) ||
    typeof value.idempotencyKey !== "string" ||
    typeof value.objectKey !== "string" ||
    typeof value.status !== "string"
  ) {
    throw new Error("Admin API staged-object GC execute response item is invalid");
  }

  return {
    idempotencyKey: value.idempotencyKey,
    objectKey: value.objectKey,
    status: value.status,
  };
}

function parseGoldenQuestionList(value: unknown): AdminGoldenQuestionList {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("Admin API golden question list response is invalid");
  }

  return {
    items: value.items.map(parseGoldenQuestion),
    ...(typeof value.nextCursor === "string" ? { nextCursor: value.nextCursor } : {}),
  };
}

function parseGoldenQuestion(value: unknown): AdminGoldenQuestion {
  if (
    !isRecord(value) ||
    !Array.isArray(value.expectedEvidenceIds) ||
    !isRecord(value.metadata) ||
    !Array.isArray(value.tags)
  ) {
    throw new Error("Admin API golden question response is invalid");
  }

  const createdAt = value.createdAt;
  const id = value.id;
  const knowledgeSpaceId = value.knowledgeSpaceId;
  const question = value.question;
  const updatedAt = value.updatedAt;

  if (
    typeof createdAt !== "string" ||
    typeof id !== "string" ||
    typeof knowledgeSpaceId !== "string" ||
    typeof question !== "string" ||
    typeof updatedAt !== "string"
  ) {
    throw new Error("Admin API golden question response is invalid");
  }

  return {
    createdAt,
    expectedEvidenceIds: parseStringArray(
      value.expectedEvidenceIds,
      "Admin API golden question expectedEvidenceIds are invalid",
    ),
    id,
    knowledgeSpaceId,
    metadata: { ...value.metadata },
    question,
    tags: parseStringArray(value.tags, "Admin API golden question tags are invalid"),
    updatedAt,
  };
}

function parseKnowledgeFsList(value: unknown): AdminKnowledgeFsList {
  if (!isRecord(value) || !Array.isArray(value.items) || typeof value.path !== "string") {
    throw new Error("Admin API KnowledgeFS list response is invalid");
  }

  if (typeof value.truncated !== "boolean") {
    throw new Error("Admin API KnowledgeFS list truncated flag is invalid");
  }

  return {
    items: value.items.map(parseKnowledgeFsEntry),
    ...(typeof value.nextCursor === "string" ? { nextCursor: value.nextCursor } : {}),
    path: value.path,
    truncated: value.truncated,
  };
}

function parseKnowledgeFsEntry(value: unknown): AdminKnowledgeFsEntry {
  if (
    !isRecord(value) ||
    (value.kind !== "directory" && value.kind !== "resource") ||
    !isRecord(value.metadata) ||
    typeof value.name !== "string" ||
    typeof value.path !== "string"
  ) {
    throw new Error("Admin API KnowledgeFS entry is invalid");
  }

  if (value.resourceType !== undefined && !isKnowledgeFsResourceType(value.resourceType)) {
    throw new Error("Admin API KnowledgeFS entry resourceType is invalid");
  }

  const version = value.version;
  if (
    version !== undefined &&
    (typeof version !== "number" || !Number.isInteger(version) || version < 1)
  ) {
    throw new Error("Admin API KnowledgeFS entry version is invalid");
  }

  return {
    kind: value.kind,
    metadata: { ...value.metadata },
    name: value.name,
    path: value.path,
    ...(typeof value.resourceType === "string" ? { resourceType: value.resourceType } : {}),
    ...(typeof value.targetId === "string" ? { targetId: value.targetId } : {}),
    ...(typeof version === "number" ? { version } : {}),
  };
}

function isKnowledgeFsResourceType(
  value: unknown,
): value is NonNullable<AdminKnowledgeFsEntry["resourceType"]> {
  return (
    value === "answer-trace" ||
    value === "document" ||
    value === "evidence-bundle" ||
    value === "node" ||
    value === "knowledge-node" ||
    value === "artifact" ||
    value === "parse-artifact" ||
    value === "source" ||
    value === "workspace"
  );
}

function parseKnowledgeFsTree(value: unknown): AdminKnowledgeFsTree {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    !isRecord(value.root) ||
    typeof value.truncated !== "boolean"
  ) {
    throw new Error("Admin API KnowledgeFS tree response is invalid");
  }

  return {
    ...(typeof value.nextCursor === "string" ? { nextCursor: value.nextCursor } : {}),
    path: value.path,
    root: parseKnowledgeFsTreeNode(value.root),
    truncated: value.truncated,
  };
}

function parseKnowledgeFsTreeNode(value: unknown): AdminKnowledgeFsTreeNode {
  const entry = parseKnowledgeFsEntry(value);
  const children = isRecord(value) && Array.isArray(value.children) ? value.children : undefined;

  return {
    ...entry,
    ...(children ? { children: children.map(parseKnowledgeFsTreeNode) } : {}),
  };
}

function parseKnowledgeFsCat(value: unknown): AdminKnowledgeFsCat {
  if (
    !isRecord(value) ||
    typeof value.contentType !== "string" ||
    typeof value.path !== "string" ||
    typeof value.text !== "string" ||
    typeof value.truncated !== "boolean"
  ) {
    throw new Error("Admin API KnowledgeFS cat response is invalid");
  }

  return {
    contentType: value.contentType,
    ...(typeof value.nextCursor === "string" ? { nextCursor: value.nextCursor } : {}),
    path: value.path,
    text: value.text,
    truncated: value.truncated,
  };
}

function parseKnowledgeFsStat(value: unknown): AdminKnowledgeFsStat {
  if (
    !isRecord(value) ||
    !isRecord(value.metadata) ||
    typeof value.path !== "string" ||
    !isKnowledgeFsResourceType(value.resourceType) ||
    typeof value.targetId !== "string"
  ) {
    throw new Error("Admin API KnowledgeFS stat response is invalid");
  }

  const version = value.version;
  if (
    version !== undefined &&
    (typeof version !== "number" || !Number.isInteger(version) || version < 1)
  ) {
    throw new Error("Admin API KnowledgeFS stat version is invalid");
  }

  return {
    ...(typeof value.contentType === "string" ? { contentType: value.contentType } : {}),
    metadata: { ...value.metadata },
    ...(isDocumentParserStatus(value.parserStatus) ? { parserStatus: value.parserStatus } : {}),
    path: value.path,
    resourceType: value.resourceType,
    ...(typeof value.sha256 === "string" ? { sha256: value.sha256 } : {}),
    ...(typeof value.sizeBytes === "number" ? { sizeBytes: value.sizeBytes } : {}),
    targetId: value.targetId,
    ...(typeof version === "number" ? { version } : {}),
  };
}

function parseKnowledgeFsWrite(value: unknown): AdminKnowledgeFsWrite {
  if (
    !isRecord(value) ||
    typeof value.bytesWritten !== "number" ||
    (value.mode !== "append" && value.mode !== "write") ||
    typeof value.objectKey !== "string" ||
    typeof value.path !== "string" ||
    typeof value.targetId !== "string" ||
    typeof value.version !== "number"
  ) {
    throw new Error("Admin API KnowledgeFS write response is invalid");
  }

  if (
    !Number.isInteger(value.bytesWritten) ||
    value.bytesWritten < 0 ||
    !Number.isInteger(value.version) ||
    value.version < 1
  ) {
    throw new Error("Admin API KnowledgeFS write response counters are invalid");
  }

  return {
    bytesWritten: value.bytesWritten,
    mode: value.mode,
    objectKey: value.objectKey,
    path: value.path,
    targetId: value.targetId,
    version: value.version,
  };
}

function parseKnowledgeFsGrep(value: unknown): AdminKnowledgeFsGrep {
  if (
    !isRecord(value) ||
    !Array.isArray(value.matches) ||
    typeof value.path !== "string" ||
    typeof value.truncated !== "boolean"
  ) {
    throw new Error("Admin API KnowledgeFS grep response is invalid");
  }

  return {
    matches: value.matches.map(parseKnowledgeFsGrepMatch),
    ...(typeof value.nextCursor === "string" ? { nextCursor: value.nextCursor } : {}),
    path: value.path,
    truncated: value.truncated,
  };
}

function parseKnowledgeFsGrepMatch(value: unknown): AdminKnowledgeFsGrepMatch {
  if (
    !isRecord(value) ||
    (value.kind !== "node" && value.kind !== "segment") ||
    !isRecord(value.metadata) ||
    typeof value.path !== "string" ||
    typeof value.snippet !== "string" ||
    typeof value.startOffset !== "number" ||
    typeof value.endOffset !== "number"
  ) {
    throw new Error("Admin API KnowledgeFS grep match is invalid");
  }

  return {
    endOffset: value.endOffset,
    kind: value.kind,
    metadata: { ...value.metadata },
    ...(typeof value.nodeId === "string" ? { nodeId: value.nodeId } : {}),
    path: value.path,
    ...(typeof value.segmentId === "string" ? { segmentId: value.segmentId } : {}),
    snippet: value.snippet,
    startOffset: value.startOffset,
  };
}

function parseKnowledgeFsOpenNode(value: unknown): AdminKnowledgeFsOpenNode {
  if (!isRecord(value) || !isRecord(value.citation) || !isRecord(value.node)) {
    throw new Error("Admin API KnowledgeFS open_node response is invalid");
  }

  const citation = value.citation;
  const node = value.node;
  if (
    typeof citation.artifactHash !== "string" ||
    typeof citation.documentAssetId !== "string" ||
    typeof citation.endOffset !== "number" ||
    typeof citation.parseArtifactId !== "string" ||
    !Array.isArray(citation.sectionPath) ||
    typeof citation.startOffset !== "number" ||
    typeof node.id !== "string" ||
    typeof node.kind !== "string" ||
    !isRecord(node.metadata) ||
    typeof node.text !== "string"
  ) {
    throw new Error("Admin API KnowledgeFS open_node response is invalid");
  }

  return {
    citation: {
      artifactHash: citation.artifactHash,
      documentAssetId: citation.documentAssetId,
      endOffset: citation.endOffset,
      ...(typeof citation.pageNumber === "number" ? { pageNumber: citation.pageNumber } : {}),
      parseArtifactId: citation.parseArtifactId,
      sectionPath: parseStringArray(
        citation.sectionPath,
        "Admin API KnowledgeFS open_node sectionPath is invalid",
      ),
      startOffset: citation.startOffset,
    },
    node: {
      id: node.id,
      kind: node.kind,
      metadata: { ...node.metadata },
      text: node.text,
    },
  };
}

function isDocumentParserStatus(value: unknown): value is AdminDocumentAsset["parserStatus"] {
  return value === "failed" || value === "parsed" || value === "pending";
}

function parseKnowledgeFsDiff(value: unknown): AdminKnowledgeFsDiff {
  if (!isRecord(value) || !Array.isArray(value.operations) || !isRecord(value.stats)) {
    throw new Error("Admin API KnowledgeFS diff response is invalid");
  }

  const mode = value.mode;
  const newPath = value.newPath;
  const oldPath = value.oldPath;

  if (
    (mode !== "line" && mode !== "word") ||
    typeof newPath !== "string" ||
    typeof oldPath !== "string"
  ) {
    throw new Error("Admin API KnowledgeFS diff response is invalid");
  }

  return {
    mode,
    newPath,
    oldPath,
    operations: value.operations.map(parseTextDiffOperation),
    ...(value.semantic === undefined ? {} : { semantic: parseSemanticDiffSummary(value.semantic) }),
    stats: parseTextDiffStats(value.stats),
  };
}

function parseAnswerTrace(value: unknown): AdminAnswerTrace {
  if (!isRecord(value) || !Array.isArray(value.steps)) {
    throw new Error("Admin API answer trace response is invalid");
  }

  const createdAt = value.createdAt;
  const id = value.id;
  const knowledgeSpaceId = value.knowledgeSpaceId;
  const mode = value.mode;
  const query = value.query;

  if (
    typeof createdAt !== "string" ||
    typeof id !== "string" ||
    typeof knowledgeSpaceId !== "string" ||
    typeof query !== "string" ||
    (mode !== "auto" && mode !== "deep" && mode !== "fast" && mode !== "research")
  ) {
    throw new Error("Admin API answer trace response is invalid");
  }

  return {
    createdAt,
    ...(typeof value.evidenceBundleId === "string"
      ? { evidenceBundleId: value.evidenceBundleId }
      : {}),
    id,
    knowledgeSpaceId,
    mode,
    query,
    steps: value.steps.map(parseAnswerTraceStep),
  };
}

function parseAnswerTraceStep(value: unknown): AdminAnswerTraceStep {
  if (!isRecord(value) || !isRecord(value.metadata)) {
    throw new Error("Admin API answer trace step is invalid");
  }

  const name = value.name;
  const startedAt = value.startedAt;
  const status = value.status;

  if (
    typeof name !== "string" ||
    typeof startedAt !== "string" ||
    (status !== "error" && status !== "ok" && status !== "skipped")
  ) {
    throw new Error("Admin API answer trace step is invalid");
  }

  return {
    ...(typeof value.endedAt === "string" ? { endedAt: value.endedAt } : {}),
    metadata: { ...value.metadata },
    name,
    startedAt,
    status,
  };
}

function parseTextDiffOperation(value: unknown): AdminTextDiffOperation {
  if (!isRecord(value) || typeof value.text !== "string") {
    throw new Error("Admin API KnowledgeFS diff operation is invalid");
  }

  if (value.kind !== "equal" && value.kind !== "insert" && value.kind !== "delete") {
    throw new Error("Admin API KnowledgeFS diff operation kind is invalid");
  }

  return {
    kind: value.kind,
    ...(value.newEnd === undefined ? {} : { newEnd: parsePositiveInteger(value.newEnd) }),
    ...(value.newStart === undefined ? {} : { newStart: parsePositiveInteger(value.newStart) }),
    ...(value.oldEnd === undefined ? {} : { oldEnd: parsePositiveInteger(value.oldEnd) }),
    ...(value.oldStart === undefined ? {} : { oldStart: parsePositiveInteger(value.oldStart) }),
    text: value.text,
  };
}

function parseTextDiffStats(value: Record<string, unknown>): AdminKnowledgeFsDiff["stats"] {
  const deleteCount = value.delete;
  const equal = value.equal;
  const insert = value.insert;

  if (
    typeof deleteCount !== "number" ||
    typeof equal !== "number" ||
    typeof insert !== "number" ||
    !Number.isInteger(deleteCount) ||
    !Number.isInteger(equal) ||
    !Number.isInteger(insert) ||
    deleteCount < 0 ||
    equal < 0 ||
    insert < 0
  ) {
    throw new Error("Admin API KnowledgeFS diff stats are invalid");
  }

  return {
    delete: deleteCount,
    equal,
    insert,
  };
}

function parseSemanticDiffSummary(value: unknown): AdminSemanticDiffSummary {
  if (
    !isRecord(value) ||
    !Array.isArray(value.changes) ||
    !isRecord(value.metadata) ||
    typeof value.summary !== "string"
  ) {
    throw new Error("Admin API semantic diff summary is invalid");
  }

  if (value.model !== undefined && typeof value.model !== "string") {
    throw new Error("Admin API semantic diff model is invalid");
  }

  return {
    changes: value.changes.map(parseSemanticDiffChange),
    metadata: { ...value.metadata },
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    summary: value.summary,
  };
}

function parseSemanticDiffChange(value: unknown): AdminSemanticDiffSummary["changes"][number] {
  if (
    !isRecord(value) ||
    typeof value.category !== "string" ||
    !Array.isArray(value.evidence) ||
    typeof value.summary !== "string"
  ) {
    throw new Error("Admin API semantic diff change is invalid");
  }

  return {
    category: value.category,
    evidence: parseStringArray(value.evidence, "Admin API semantic diff evidence is invalid"),
    summary: value.summary,
  };
}

function parseDocumentAsset(value: unknown): AdminDocumentAsset {
  if (!isRecord(value)) {
    throw new Error("Admin API document asset response is invalid");
  }

  const createdAt = value.createdAt;
  const filename = value.filename;
  const id = value.id;
  const knowledgeSpaceId = value.knowledgeSpaceId;
  const mimeType = value.mimeType;
  const objectKey = value.objectKey;
  const parserStatus = value.parserStatus;
  const sha256 = value.sha256;
  const sizeBytes = value.sizeBytes;
  const version = value.version;

  if (
    typeof createdAt !== "string" ||
    typeof filename !== "string" ||
    typeof id !== "string" ||
    typeof knowledgeSpaceId !== "string" ||
    typeof mimeType !== "string" ||
    typeof objectKey !== "string" ||
    typeof sha256 !== "string"
  ) {
    throw new Error("Admin API document asset response is invalid");
  }

  if (parserStatus !== "pending" && parserStatus !== "parsed" && parserStatus !== "failed") {
    throw new Error("Admin API document asset parserStatus is invalid");
  }

  if (!isRecord(value.metadata)) {
    throw new Error("Admin API document asset metadata is invalid");
  }

  if (!Number.isInteger(sizeBytes) || typeof sizeBytes !== "number" || sizeBytes < 0) {
    throw new Error("Admin API document asset sizeBytes is invalid");
  }

  if (!Number.isInteger(version) || typeof version !== "number" || version < 1) {
    throw new Error("Admin API document asset version is invalid");
  }

  return {
    createdAt,
    filename,
    id,
    knowledgeSpaceId,
    metadata: { ...value.metadata },
    mimeType,
    objectKey,
    parserStatus,
    sha256,
    sizeBytes,
    ...(typeof value.sourceId === "string" ? { sourceId: value.sourceId } : {}),
    version,
  };
}

function parseDocumentMultimodalManifest(value: unknown): AdminDocumentMultimodalManifest {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.metadata)) {
    throw new Error("Admin API document multimodal manifest response is invalid");
  }

  const artifactHash = value.artifactHash;
  const createdAt = value.createdAt;
  const documentAssetId = value.documentAssetId;
  const id = value.id;
  const knowledgeSpaceId = value.knowledgeSpaceId;
  const manifestVersion = value.manifestVersion;
  const parseArtifactId = value.parseArtifactId;
  const version = value.version;

  if (
    typeof artifactHash !== "string" ||
    typeof createdAt !== "string" ||
    typeof documentAssetId !== "string" ||
    typeof id !== "string" ||
    typeof knowledgeSpaceId !== "string" ||
    typeof manifestVersion !== "string" ||
    typeof parseArtifactId !== "string" ||
    !Number.isInteger(version) ||
    typeof version !== "number" ||
    version < 1
  ) {
    throw new Error("Admin API document multimodal manifest response is invalid");
  }

  return {
    artifactHash,
    createdAt,
    documentAssetId,
    id,
    items: value.items.map(parseDocumentMultimodalItem),
    knowledgeSpaceId,
    manifestVersion,
    metadata: { ...value.metadata },
    parseArtifactId,
    ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
    version,
  };
}

function parseDocumentMultimodalItem(value: unknown): AdminDocumentMultimodalItem {
  if (!isRecord(value) || !isRecord(value.enrichment) || !Array.isArray(value.sectionPath)) {
    throw new Error("Admin API document multimodal item is invalid");
  }

  const id = value.id;
  const modality = value.modality;
  const parseElementId = value.parseElementId;

  if (
    typeof id !== "string" ||
    typeof parseElementId !== "string" ||
    !isDocumentMultimodalModality(modality)
  ) {
    throw new Error("Admin API document multimodal item is invalid");
  }

  return {
    ...(isRecord(value.assetRef)
      ? { assetRef: parseDocumentMultimodalAssetRef(value.assetRef) }
      : {}),
    ...(isRecord(value.boundingBox)
      ? { boundingBox: parseDocumentMultimodalBoundingBox(value.boundingBox) }
      : {}),
    ...(typeof value.caption === "string" ? { caption: value.caption } : {}),
    ...(typeof value.endOffset === "number" ? { endOffset: value.endOffset } : {}),
    enrichment: parseStringRecord(value.enrichment),
    id,
    modality,
    ...(typeof value.ocrText === "string" ? { ocrText: value.ocrText } : {}),
    ...(typeof value.pageNumber === "number" ? { pageNumber: value.pageNumber } : {}),
    parseElementId,
    sectionPath: parseStringArray(value.sectionPath, "Admin API multimodal section path invalid"),
    sourceMetadata: isRecord(value.sourceMetadata) ? { ...value.sourceMetadata } : {},
    ...(typeof value.startOffset === "number" ? { startOffset: value.startOffset } : {}),
    ...(typeof value.textPreview === "string" ? { textPreview: value.textPreview } : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
  };
}

function parseDocumentMultimodalBoundingBox(
  value: Readonly<Record<string, unknown>>,
): AdminDocumentMultimodalBoundingBox | undefined {
  const height = value.height;
  const width = value.width;
  const x = value.x;
  const y = value.y;

  if (
    typeof height !== "number" ||
    typeof width !== "number" ||
    typeof x !== "number" ||
    typeof y !== "number"
  ) {
    return undefined;
  }

  return { height, width, x, y };
}

function parseDocumentMultimodalAssetRef(
  value: Readonly<Record<string, unknown>>,
): AdminDocumentMultimodalAssetRef {
  return {
    ...(typeof value.contentType === "string" ? { contentType: value.contentType } : {}),
    ...(typeof value.objectKey === "string" ? { objectKey: value.objectKey } : {}),
    ...(typeof value.sha256 === "string" ? { sha256: value.sha256 } : {}),
    ...(typeof value.uri === "string" ? { uri: value.uri } : {}),
    ...(isRecord(value.variants)
      ? { variants: parseDocumentMultimodalAssetVariants(value.variants) }
      : {}),
  };
}

function parseDocumentMultimodalAssetVariants(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, AdminDocumentMultimodalAssetVariant>> {
  const variants: Record<string, AdminDocumentMultimodalAssetVariant> = {};

  for (const [name, variant] of Object.entries(value)) {
    if (!isRecord(variant)) {
      continue;
    }

    variants[name] = {
      ...(typeof variant.contentType === "string" ? { contentType: variant.contentType } : {}),
      ...(typeof variant.height === "number" ? { height: variant.height } : {}),
      ...(typeof variant.objectKey === "string" ? { objectKey: variant.objectKey } : {}),
      ...(typeof variant.sha256 === "string" ? { sha256: variant.sha256 } : {}),
      ...(typeof variant.uri === "string" ? { uri: variant.uri } : {}),
      ...(typeof variant.width === "number" ? { width: variant.width } : {}),
    };
  }

  return variants;
}

function isDocumentMultimodalModality(
  value: unknown,
): value is AdminDocumentMultimodalItem["modality"] {
  return value === "code" || value === "image" || value === "page" || value === "table";
}

function parseStringRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function parseDocumentOutline(value: unknown): AdminDocumentOutline {
  if (!isRecord(value) || !Array.isArray(value.nodes)) {
    throw new Error("Admin API document outline response is invalid");
  }

  const artifactHash = value.artifactHash;
  const createdAt = value.createdAt;
  const documentAssetId = value.documentAssetId;
  const id = value.id;
  const knowledgeSpaceId = value.knowledgeSpaceId;
  const outlineVersion = value.outlineVersion;
  const parseArtifactId = value.parseArtifactId;
  const version = value.version;

  if (
    typeof artifactHash !== "string" ||
    typeof createdAt !== "string" ||
    typeof documentAssetId !== "string" ||
    typeof id !== "string" ||
    typeof knowledgeSpaceId !== "string" ||
    typeof outlineVersion !== "string" ||
    typeof parseArtifactId !== "string"
  ) {
    throw new Error("Admin API document outline response is invalid");
  }

  if (!isRecord(value.metadata)) {
    throw new Error("Admin API document outline metadata is invalid");
  }

  if (!Number.isInteger(version) || typeof version !== "number" || version < 1) {
    throw new Error("Admin API document outline version is invalid");
  }

  return {
    artifactHash,
    createdAt,
    documentAssetId,
    id,
    knowledgeSpaceId,
    metadata: { ...value.metadata },
    nodes: value.nodes.map(parseDocumentOutlineNode),
    outlineVersion,
    parseArtifactId,
    ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
    version,
  };
}

function parseDocumentOutlineNode(value: unknown): AdminDocumentOutlineNode {
  if (!isRecord(value) || !Array.isArray(value.children) || !isRecord(value.metadata)) {
    throw new Error("Admin API document outline node is invalid");
  }

  const id = value.id;
  const level = value.level;
  const title = value.title;
  const tocSource = value.tocSource;

  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    !Number.isInteger(level) ||
    typeof level !== "number" ||
    !isDocumentOutlineTocSource(tocSource)
  ) {
    throw new Error("Admin API document outline node is invalid");
  }

  const childNodeIds = value.childNodeIds;
  const children = value.children;
  const sectionPath = value.sectionPath;
  const sourceElementIds = value.sourceElementIds;
  const sourceNodeIds = value.sourceNodeIds;

  if (
    !Array.isArray(childNodeIds) ||
    !Array.isArray(children) ||
    !Array.isArray(sectionPath) ||
    !Array.isArray(sourceElementIds) ||
    !Array.isArray(sourceNodeIds)
  ) {
    throw new Error("Admin API document outline node arrays are invalid");
  }

  return {
    childNodeIds: parseStringArray(childNodeIds, "Admin API outline child ids invalid"),
    children: children.map(parseDocumentOutlineNode),
    ...(typeof value.endOffset === "number" ? { endOffset: value.endOffset } : {}),
    ...(typeof value.endPage === "number" ? { endPage: value.endPage } : {}),
    id,
    level,
    metadata: { ...value.metadata },
    sectionPath: parseStringArray(sectionPath, "Admin API outline section path invalid"),
    sourceElementIds: parseStringArray(
      sourceElementIds,
      "Admin API outline source element ids invalid",
    ),
    sourceNodeIds: parseStringArray(sourceNodeIds, "Admin API outline source node ids invalid"),
    ...(typeof value.startOffset === "number" ? { startOffset: value.startOffset } : {}),
    ...(typeof value.startPage === "number" ? { startPage: value.startPage } : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    title,
    ...(value.titleLocation === undefined
      ? {}
      : { titleLocation: parseDocumentOutlineTitleLocation(value.titleLocation) }),
    tocSource,
  };
}

function parseDocumentOutlineTitleLocation(value: unknown): AdminDocumentOutlineTitleLocation {
  if (!isRecord(value) || !isDocumentOutlineTocSource(value.source)) {
    throw new Error("Admin API document outline title location is invalid");
  }

  if (typeof value.confidence !== "number") {
    throw new Error("Admin API document outline title location confidence is invalid");
  }

  return {
    confidence: value.confidence,
    ...(typeof value.endOffset === "number" ? { endOffset: value.endOffset } : {}),
    ...(typeof value.matchedText === "string" ? { matchedText: value.matchedText } : {}),
    ...(typeof value.pageNumber === "number" ? { pageNumber: value.pageNumber } : {}),
    source: value.source,
    ...(typeof value.startOffset === "number" ? { startOffset: value.startOffset } : {}),
  };
}

function isDocumentOutlineTocSource(
  value: unknown,
): value is AdminDocumentOutlineNode["tocSource"] {
  return (
    value === "fallback" ||
    value === "llm-inferred" ||
    value === "native-toc" ||
    value === "parser-heading"
  );
}

function parseDocumentAssetList(value: unknown): AdminDocumentAssetList {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("Admin API document asset list response is invalid");
  }

  return {
    items: value.items.map(parseDocumentAsset),
    ...(typeof value.nextCursor === "string" ? { nextCursor: value.nextCursor } : {}),
  };
}

function parseSemanticTopicMaterializationResult(
  value: unknown,
): AdminSemanticTopicMaterializationResult {
  if (!isRecord(value)) {
    throw new Error("Admin API semantic topic materialization response is invalid");
  }

  const documentCount = value.documentCount;
  const generatedVersion = value.generatedVersion;
  const knowledgeSpaceId = value.knowledgeSpaceId;
  const pathCount = value.pathCount;
  const topicName = value.topicName;
  const topicSlug = value.topicSlug;

  if (
    !Number.isInteger(documentCount) ||
    typeof documentCount !== "number" ||
    !Number.isInteger(pathCount) ||
    typeof pathCount !== "number" ||
    typeof generatedVersion !== "string" ||
    typeof knowledgeSpaceId !== "string" ||
    typeof topicName !== "string" ||
    typeof topicSlug !== "string"
  ) {
    throw new Error("Admin API semantic topic materialization response is invalid");
  }

  return {
    documentCount,
    generatedVersion,
    knowledgeSpaceId,
    pathCount,
    topicName,
    topicSlug,
  };
}

function parseSemanticCommunityMaterializationResult(
  value: unknown,
): AdminSemanticCommunityMaterializationResult {
  if (!isRecord(value)) {
    throw new Error("Admin API semantic community materialization response is invalid");
  }

  const communityCount = value.communityCount;
  const documentCount = value.documentCount;
  const entityCount = value.entityCount;
  const generatedVersion = value.generatedVersion;
  const knowledgeSpaceId = value.knowledgeSpaceId;
  const pathCount = value.pathCount;

  if (
    !Number.isInteger(communityCount) ||
    typeof communityCount !== "number" ||
    !Number.isInteger(documentCount) ||
    typeof documentCount !== "number" ||
    !Number.isInteger(entityCount) ||
    typeof entityCount !== "number" ||
    !Number.isInteger(pathCount) ||
    typeof pathCount !== "number" ||
    typeof generatedVersion !== "string" ||
    typeof knowledgeSpaceId !== "string"
  ) {
    throw new Error("Admin API semantic community materialization response is invalid");
  }

  return {
    communityCount,
    documentCount,
    entityCount,
    generatedVersion,
    knowledgeSpaceId,
    pathCount,
  };
}

function parseSemanticEntityExtractionResult(value: unknown): AdminSemanticEntityExtractionResult {
  if (!isRecord(value)) {
    throw new Error("Admin API semantic entity extraction response is invalid");
  }

  const entitiesExtracted = value.entitiesExtracted;
  const extractionMode = value.extractionMode;
  const graphEntitiesIndexed = value.graphEntitiesIndexed;
  const graphRelationsIndexed = value.graphRelationsIndexed;
  const knowledgeSpaceId = value.knowledgeSpaceId;
  const nodesScanned = value.nodesScanned;
  const nodesUpdated = value.nodesUpdated;

  if (
    !Number.isInteger(entitiesExtracted) ||
    typeof entitiesExtracted !== "number" ||
    extractionMode !== "provider" ||
    !Number.isInteger(graphEntitiesIndexed) ||
    typeof graphEntitiesIndexed !== "number" ||
    !Number.isInteger(graphRelationsIndexed) ||
    typeof graphRelationsIndexed !== "number" ||
    typeof knowledgeSpaceId !== "string" ||
    !Number.isInteger(nodesScanned) ||
    typeof nodesScanned !== "number" ||
    !Number.isInteger(nodesUpdated) ||
    typeof nodesUpdated !== "number"
  ) {
    throw new Error("Admin API semantic entity extraction response is invalid");
  }

  return {
    entitiesExtracted,
    extractionMode,
    graphEntitiesIndexed,
    graphRelationsIndexed,
    knowledgeSpaceId,
    nodesScanned,
    nodesUpdated,
  };
}

function parseGraphTraversal(value: unknown): AdminGraphTraversal {
  if (
    !isRecord(value) ||
    !Array.isArray(value.entities) ||
    !Array.isArray(value.relations) ||
    !isRecord(value.metrics) ||
    typeof value.truncated !== "boolean"
  ) {
    throw new Error("Admin API graph traversal response is invalid");
  }

  return {
    entities: value.entities.map(parseGraphEntity),
    metrics: parseGraphMetrics(value.metrics),
    relations: value.relations.map(parseGraphRelation),
    truncated: value.truncated,
  };
}

function parseGraphEntity(value: unknown): AdminGraphEntity {
  if (
    !isRecord(value) ||
    !Array.isArray(value.aliases) ||
    !Array.isArray(value.permissionScope) ||
    !Array.isArray(value.sourceNodeIds) ||
    !isRecord(value.metadata)
  ) {
    throw new Error("Admin API graph entity is invalid");
  }

  const canonicalKey = value.canonicalKey;
  const confidence = value.confidence;
  const createdAt = value.createdAt;
  const depth = value.depth;
  const extractionVersion = value.extractionVersion;
  const id = value.id;
  const knowledgeSpaceId = value.knowledgeSpaceId;
  const name = value.name;
  const type = value.type;
  const updatedAt = value.updatedAt;

  if (
    typeof canonicalKey !== "string" ||
    typeof confidence !== "number" ||
    typeof createdAt !== "string" ||
    typeof depth !== "number" ||
    typeof extractionVersion !== "number" ||
    typeof id !== "string" ||
    typeof knowledgeSpaceId !== "string" ||
    typeof name !== "string" ||
    typeof updatedAt !== "string" ||
    !isGraphEntityType(type)
  ) {
    throw new Error("Admin API graph entity is invalid");
  }

  if (
    !Number.isInteger(depth) ||
    depth < 0 ||
    !Number.isInteger(extractionVersion) ||
    extractionVersion < 1
  ) {
    throw new Error("Admin API graph entity numeric fields are invalid");
  }

  return {
    aliases: parseStringArray(value.aliases, "Admin API graph entity aliases are invalid"),
    canonicalKey,
    confidence,
    createdAt,
    depth,
    extractionVersion,
    id,
    knowledgeSpaceId,
    metadata: { ...value.metadata },
    name,
    permissionScope: parseStringArray(
      value.permissionScope,
      "Admin API graph entity permissionScope is invalid",
    ),
    sourceNodeIds: parseStringArray(
      value.sourceNodeIds,
      "Admin API graph entity sourceNodeIds are invalid",
    ),
    type,
    updatedAt,
  };
}

function parseGraphRelation(value: unknown): AdminGraphRelation {
  if (
    !isRecord(value) ||
    !Array.isArray(value.permissionScope) ||
    !Array.isArray(value.sourceNodeIds) ||
    !isRecord(value.metadata)
  ) {
    throw new Error("Admin API graph relation is invalid");
  }

  const confidence = value.confidence;
  const createdAt = value.createdAt;
  const depth = value.depth;
  const extractionVersion = value.extractionVersion;
  const id = value.id;
  const knowledgeSpaceId = value.knowledgeSpaceId;
  const objectEntityId = value.objectEntityId;
  const subjectEntityId = value.subjectEntityId;
  const type = value.type;
  const updatedAt = value.updatedAt;

  if (
    typeof confidence !== "number" ||
    typeof createdAt !== "string" ||
    typeof depth !== "number" ||
    typeof extractionVersion !== "number" ||
    typeof id !== "string" ||
    typeof knowledgeSpaceId !== "string" ||
    typeof objectEntityId !== "string" ||
    typeof subjectEntityId !== "string" ||
    typeof updatedAt !== "string" ||
    !isGraphRelationType(type)
  ) {
    throw new Error("Admin API graph relation is invalid");
  }

  if (
    !Number.isInteger(depth) ||
    depth < 1 ||
    !Number.isInteger(extractionVersion) ||
    extractionVersion < 1
  ) {
    throw new Error("Admin API graph relation numeric fields are invalid");
  }

  return {
    confidence,
    createdAt,
    depth,
    extractionVersion,
    id,
    knowledgeSpaceId,
    metadata: { ...value.metadata },
    objectEntityId,
    permissionScope: parseStringArray(
      value.permissionScope,
      "Admin API graph relation permissionScope is invalid",
    ),
    sourceNodeIds: parseStringArray(
      value.sourceNodeIds,
      "Admin API graph relation sourceNodeIds are invalid",
    ),
    subjectEntityId,
    type,
    updatedAt,
  };
}

function parseGraphMetrics(value: Record<string, unknown>): AdminGraphTraversal["metrics"] {
  const depthReached = value.depthReached;
  const elapsedMs = value.elapsedMs;
  const exploredRelations = value.exploredRelations;
  const fanout = value.fanout;
  const maxDepth = value.maxDepth;
  const maxNodes = value.maxNodes;
  const timedOut = value.timedOut;

  if (
    typeof depthReached !== "number" ||
    typeof elapsedMs !== "number" ||
    typeof exploredRelations !== "number" ||
    typeof fanout !== "number" ||
    typeof maxDepth !== "number" ||
    typeof maxNodes !== "number" ||
    !Number.isInteger(depthReached) ||
    !Number.isInteger(exploredRelations) ||
    !Number.isInteger(fanout) ||
    !Number.isInteger(maxDepth) ||
    !Number.isInteger(maxNodes) ||
    typeof timedOut !== "boolean"
  ) {
    throw new Error("Admin API graph traversal metrics are invalid");
  }

  return {
    depthReached,
    elapsedMs,
    exploredRelations,
    fanout,
    maxDepth,
    maxNodes,
    timedOut,
  };
}

function isGraphEntityType(value: unknown): value is AdminGraphEntityType {
  return (
    value === "date" ||
    value === "metric" ||
    value === "organization" ||
    value === "person" ||
    value === "policy" ||
    value === "product" ||
    value === "term"
  );
}

function isGraphRelationType(value: unknown): value is AdminGraphRelationType {
  return (
    value === "contradicts" ||
    value === "defines" ||
    value === "depends_on" ||
    value === "mentions" ||
    value === "references" ||
    value === "supersedes"
  );
}

function parseParseArtifact(value: unknown): AdminParseArtifact {
  if (!isRecord(value) || !Array.isArray(value.elements) || !isRecord(value.metadata)) {
    throw new Error("Admin API parse artifact response is invalid");
  }

  const artifactHash = value.artifactHash;
  const contentType = value.contentType;
  const createdAt = value.createdAt;
  const documentAssetId = value.documentAssetId;
  const id = value.id;
  const parser = value.parser;
  const version = value.version;

  if (
    typeof artifactHash !== "string" ||
    typeof createdAt !== "string" ||
    typeof documentAssetId !== "string" ||
    typeof id !== "string"
  ) {
    throw new Error("Admin API parse artifact response is invalid");
  }

  if (contentType !== "text" && contentType !== "structured" && contentType !== "mixed") {
    throw new Error("Admin API parse artifact contentType is invalid");
  }

  if (
    parser !== "native-markdown" &&
    parser !== "native-html" &&
    parser !== "native-structured" &&
    parser !== "unstructured"
  ) {
    throw new Error("Admin API parse artifact parser is invalid");
  }

  if (!Number.isInteger(version) || typeof version !== "number" || version < 1) {
    throw new Error("Admin API parse artifact version is invalid");
  }

  return {
    artifactHash,
    contentType,
    createdAt,
    documentAssetId,
    elements: value.elements.map(parseParseElement),
    id,
    metadata: { ...value.metadata },
    parser,
    version,
  };
}

function parseParseElement(value: unknown): AdminParseElement {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.metadata)) {
    throw new Error("Admin API parse element is invalid");
  }

  if (
    value.type !== "title" &&
    value.type !== "heading" &&
    value.type !== "paragraph" &&
    value.type !== "table" &&
    value.type !== "list" &&
    value.type !== "image" &&
    value.type !== "code" &&
    value.type !== "page-break"
  ) {
    throw new Error("Admin API parse element type is invalid");
  }

  if (
    !Array.isArray(value.sectionPath) ||
    value.sectionPath.some((section) => typeof section !== "string")
  ) {
    throw new Error("Admin API parse element sectionPath is invalid");
  }

  const pageNumber = value.pageNumber;
  if (
    pageNumber !== undefined &&
    (typeof pageNumber !== "number" || !Number.isInteger(pageNumber) || pageNumber < 1)
  ) {
    throw new Error("Admin API parse element pageNumber is invalid");
  }

  if (value.text !== undefined && typeof value.text !== "string") {
    throw new Error("Admin API parse element text is invalid");
  }

  return {
    id: value.id,
    metadata: { ...value.metadata },
    ...(typeof pageNumber === "number" ? { pageNumber } : {}),
    sectionPath: [...value.sectionPath],
    ...(typeof value.text === "string" ? { text: value.text } : {}),
    type: value.type,
  };
}

function parseStringArray(value: readonly unknown[], errorMessage: string): string[] {
  if (value.some((item) => typeof item !== "string")) {
    throw new Error(errorMessage);
  }

  return [...value] as string[];
}

function parsePositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("Admin API positive integer field is invalid");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "number");
}
