import type {
  ConcurrencyGateEvent,
  DifyCapabilityV2OperationalMetric,
  DifyCapabilityV2OperationalMetrics,
  DocumentOutlineSummaryOperationalMetric,
  DocumentOutlineSummaryOperationalMetrics,
  DocumentSemanticEnrichmentOperationalMetric,
  DocumentSemanticEnrichmentOperationalMetrics,
  DurableTaskOperationalMetric,
  DurableTaskOperationalMetrics,
  IngestionModelCallOperationalMetric,
  IngestionModelCallOperationalMetrics,
  LegacyAuthorizationTrafficMetric,
  LegacyAuthorizationTrafficMetrics,
  RetrievalOperationalMetric,
  RetrievalOperationalMetrics,
  UploadSessionMetric,
  UploadSessionOperationalMetrics,
} from "@knowledge/api";
import type {
  DifyModelRuntimeEmbeddingOperationalMetric,
  DifyModelRuntimeEmbeddingOperationalMetrics,
} from "@knowledge/embeddings";

export type ApiKnowledgeFsOperationalMetric =
  | (DifyModelRuntimeEmbeddingOperationalMetric & {
      readonly event: "knowledge_fs.embedding_request.metric";
    })
  | (ConcurrencyGateEvent & {
      readonly event: "knowledge_fs.ingestion_model_concurrency.metric";
    })
  | (IngestionModelCallOperationalMetric & {
      readonly event: "knowledge_fs.ingestion_model_call.metric";
    })
  | (DifyCapabilityV2OperationalMetric & {
      readonly event: "knowledge_fs.capability_v2.metric";
    })
  | (DocumentSemanticEnrichmentOperationalMetric & {
      readonly event: "knowledge_fs.semantic_enrichment.metric";
    })
  | (DocumentOutlineSummaryOperationalMetric & {
      readonly event: "knowledge_fs.outline_summary.metric";
    })
  | (UploadSessionMetric & {
      readonly event: "knowledge_fs.upload_session.metric";
    })
  | (RetrievalOperationalMetric & {
      readonly event: "knowledge_fs.retrieval.metric";
    })
  | (DurableTaskOperationalMetric & {
      readonly event: "knowledge_fs.durable_task.metric";
    })
  | (LegacyAuthorizationTrafficMetric & {
      readonly event: "knowledge_fs.legacy_authorization.metric";
    });

export interface ApiKnowledgeFsOperationalMetrics {
  readonly capabilityV2: DifyCapabilityV2OperationalMetrics;
  readonly durableTasks: DurableTaskOperationalMetrics;
  readonly embeddingRequests: DifyModelRuntimeEmbeddingOperationalMetrics;
  readonly legacyAuthorization: LegacyAuthorizationTrafficMetrics;
  readonly ingestionModel: {
    record(metric: ConcurrencyGateEvent): Promise<void> | void;
  };
  readonly ingestionModelCalls: IngestionModelCallOperationalMetrics;
  readonly semanticEnrichment: DocumentSemanticEnrichmentOperationalMetrics;
  readonly outlineSummary: DocumentOutlineSummaryOperationalMetrics;
  readonly retrieval: RetrievalOperationalMetrics;
  readonly uploadSessions: UploadSessionOperationalMetrics;
}

/**
 * Adapt bounded package events to structured production logs. The events intentionally contain no
 * request/resource identifiers, credentials, checksums, object keys, URLs, or free-form errors.
 */
export function createApiKnowledgeFsOperationalMetrics({
  emit,
}: {
  readonly emit: (metric: ApiKnowledgeFsOperationalMetric) => Promise<void> | void;
}): ApiKnowledgeFsOperationalMetrics {
  return {
    capabilityV2: {
      record: (metric) =>
        safelyEmit(emit, { event: "knowledge_fs.capability_v2.metric", ...metric }),
    },
    durableTasks: {
      record: (metric) =>
        safelyEmit(emit, { event: "knowledge_fs.durable_task.metric", ...metric }),
    },
    embeddingRequests: {
      record: (metric) =>
        safelyEmit(emit, { event: "knowledge_fs.embedding_request.metric", ...metric }),
    },
    legacyAuthorization: {
      record: (metric) =>
        safelyEmit(emit, { event: "knowledge_fs.legacy_authorization.metric", ...metric }),
    },
    ingestionModel: {
      record: (metric) =>
        safelyEmit(emit, { event: "knowledge_fs.ingestion_model_concurrency.metric", ...metric }),
    },
    ingestionModelCalls: {
      record: (metric) =>
        safelyEmit(emit, { event: "knowledge_fs.ingestion_model_call.metric", ...metric }),
    },
    semanticEnrichment: {
      record: (metric) =>
        safelyEmit(emit, { event: "knowledge_fs.semantic_enrichment.metric", ...metric }),
    },
    outlineSummary: {
      record: (metric) =>
        safelyEmit(emit, { event: "knowledge_fs.outline_summary.metric", ...metric }),
    },
    retrieval: {
      record: (metric) => safelyEmit(emit, { event: "knowledge_fs.retrieval.metric", ...metric }),
    },
    uploadSessions: {
      record: (metric) =>
        safelyEmit(emit, { event: "knowledge_fs.upload_session.metric", ...metric }),
    },
  };
}

function safelyEmit(
  emit: (metric: ApiKnowledgeFsOperationalMetric) => Promise<void> | void,
  metric: ApiKnowledgeFsOperationalMetric,
): void {
  try {
    const pending = emit(metric);
    if (pending instanceof Promise) void pending.catch(() => undefined);
  } catch {
    // Operational telemetry must not own authentication, retrieval, upload, or durable task state.
  }
}
