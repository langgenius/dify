import type {
  DifyCapabilityV2OperationalMetric,
  DifyCapabilityV2OperationalMetrics,
  DurableTaskOperationalMetric,
  DurableTaskOperationalMetrics,
  LegacyAuthorizationTrafficMetric,
  LegacyAuthorizationTrafficMetrics,
  RetrievalOperationalMetric,
  RetrievalOperationalMetrics,
  UploadSessionMetric,
  UploadSessionOperationalMetrics,
} from "@knowledge/api";

export type ApiKnowledgeFsOperationalMetric =
  | (DifyCapabilityV2OperationalMetric & {
      readonly event: "knowledge_fs.capability_v2.metric";
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
  readonly legacyAuthorization: LegacyAuthorizationTrafficMetrics;
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
    legacyAuthorization: {
      record: (metric) =>
        safelyEmit(emit, { event: "knowledge_fs.legacy_authorization.metric", ...metric }),
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
