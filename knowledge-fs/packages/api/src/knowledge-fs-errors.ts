export const KnowledgeFsErrorCategoryValues = [
  "authorization",
  "canceled",
  "configuration",
  "conflict",
  "dependency",
  "internal",
  "not_found",
  "rate_limit",
  "timeout",
  "validation",
] as const;

export type KnowledgeFsErrorCategory = (typeof KnowledgeFsErrorCategoryValues)[number];

export const KnowledgeFsRetryPolicyValues = [
  "automatic",
  "manual",
  "after_configuration",
  "never",
] as const;

export type KnowledgeFsRetryPolicy = (typeof KnowledgeFsRetryPolicyValues)[number];

export const KnowledgeFsRecoveryActionValues = [
  "configure_model",
  "configure_parser",
  "configure_source",
  "contact_admin",
  "reupload",
  "retry",
] as const;

export type KnowledgeFsRecoveryAction = (typeof KnowledgeFsRecoveryActionValues)[number];

export type KnowledgeFsFailureParameter = boolean | number | string;

export const KnowledgeFsFailureParameterKeyValues = [
  "attempt",
  "documentCount",
  "fileSizeBytes",
  "limit",
  "maxFileSizeBytes",
  "maxItems",
  "modelType",
  "providerKind",
  "retryAfterSeconds",
  "status",
] as const;

export type KnowledgeFsFailureParameterKey = (typeof KnowledgeFsFailureParameterKeyValues)[number];

export interface KnowledgeFsPublicFailure {
  readonly action?: KnowledgeFsRecoveryAction | undefined;
  readonly category: KnowledgeFsErrorCategory;
  readonly code: KnowledgeFsErrorCode;
  readonly message: string;
  readonly parameters?: Readonly<Record<string, KnowledgeFsFailureParameter>> | undefined;
  readonly retryPolicy: KnowledgeFsRetryPolicy;
  readonly stage?: string | undefined;
  readonly traceId?: string | undefined;
}

interface KnowledgeFsErrorDescriptor {
  readonly action?: KnowledgeFsRecoveryAction | undefined;
  readonly category: KnowledgeFsErrorCategory;
  readonly httpStatus: number;
  readonly message: string;
  readonly retryPolicy: KnowledgeFsRetryPolicy;
}

const invalidRequest = descriptor(
  "validation",
  "The KnowledgeFS request is invalid.",
  "never",
  400,
);
const notFound = descriptor(
  "not_found",
  "The requested KnowledgeFS resource was not found.",
  "never",
  404,
);
const conflict = descriptor(
  "conflict",
  "The KnowledgeFS operation conflicts with the current resource state.",
  "manual",
  409,
  "retry",
);
const unavailable = descriptor(
  "dependency",
  "KnowledgeFS is temporarily unavailable. Try again later.",
  "manual",
  503,
  "retry",
);
const internal = descriptor(
  "internal",
  "KnowledgeFS could not complete the operation. Try again, or contact an administrator with the error reference.",
  "manual",
  500,
  "contact_admin",
);

/**
 * Safe, stable public failures. Messages in this catalog may be persisted and returned to clients.
 * Provider/runtime exception messages are never copied here because they can contain credentials,
 * request headers, signed URLs, or other deployment details.
 */
export const KNOWLEDGE_FS_ERROR_CATALOG = {
  DOCUMENT_COMPILATION_FAILED: descriptor(
    "internal",
    "The document could not be processed. Try again, or contact an administrator with the error reference.",
    "manual",
    500,
    "contact_admin",
  ),
  DOCUMENT_COMPILATION_RETRYABLE: descriptor(
    "dependency",
    "Document processing was interrupted by a temporary service failure.",
    "automatic",
    503,
    "retry",
  ),
  DOCUMENT_DISABLED: descriptor(
    "conflict",
    "The document was disabled while it was being processed.",
    "never",
    409,
  ),
  DOCUMENT_PARSER_INPUT_INVALID: descriptor(
    "validation",
    "The document could not be read by the configured parser.",
    "never",
    422,
    "reupload",
  ),
  DOCUMENT_PARSER_NOT_CONFIGURED: descriptor(
    "configuration",
    "The document parser is not configured. Configure it before retrying.",
    "after_configuration",
    422,
    "configure_parser",
  ),
  DOCUMENT_PARSER_RATE_LIMITED: descriptor(
    "rate_limit",
    "The document parser is busy. Try again later.",
    "automatic",
    429,
    "retry",
  ),
  DOCUMENT_PARSER_RESPONSE_INVALID: descriptor(
    "dependency",
    "The document parser returned an invalid response.",
    "manual",
    502,
    "retry",
  ),
  DOCUMENT_PARSER_TIMEOUT: descriptor(
    "timeout",
    "The document parser did not finish within the allowed time. Try again.",
    "manual",
    504,
    "retry",
  ),
  DOCUMENT_PARSER_UNAVAILABLE: descriptor(
    "dependency",
    "The document parser is temporarily unavailable.",
    "automatic",
    503,
    "retry",
  ),
  EMBEDDING_DIMENSION_INVALID: descriptor(
    "configuration",
    "The selected embedding model returned an invalid vector dimension. Select a compatible model before retrying.",
    "after_configuration",
    422,
    "configure_model",
  ),
  EMBEDDING_DIMENSION_UNSUPPORTED: descriptor(
    "configuration",
    "The selected embedding model is not compatible with the configured vector storage. Select another model before retrying.",
    "after_configuration",
    422,
    "configure_model",
  ),
  EXECUTION_ATTEMPTS_EXHAUSTED: descriptor(
    "dependency",
    "Document processing failed after all automatic retry attempts.",
    "manual",
    503,
    "retry",
  ),
  KNOWLEDGE_FS_ACCESS_DENIED: descriptor(
    "authorization",
    "You do not have permission to perform this KnowledgeFS operation.",
    "never",
    403,
    "contact_admin",
  ),
  KNOWLEDGE_FS_CONFLICT: conflict,
  KNOWLEDGE_FS_INTERNAL_ERROR: internal,
  KNOWLEDGE_FS_INVALID_REQUEST: invalidRequest,
  KNOWLEDGE_FS_NOT_FOUND: notFound,
  KNOWLEDGE_FS_RATE_LIMITED: descriptor(
    "rate_limit",
    "Too many KnowledgeFS operations were requested. Try again later.",
    "manual",
    429,
    "retry",
  ),
  KNOWLEDGE_FS_TIMEOUT: descriptor(
    "timeout",
    "The KnowledgeFS operation timed out. Try again later.",
    "manual",
    503,
    "retry",
  ),
  KNOWLEDGE_FS_UNAVAILABLE: unavailable,
  KNOWLEDGE_SPACE_MANIFEST_NOT_FOUND: descriptor(
    "configuration",
    "The knowledge space model configuration is unavailable. Configure the models before retrying.",
    "after_configuration",
    422,
    "configure_model",
  ),
  KNOWLEDGE_SPACE_MODEL_CONFIGURATION_REQUIRED: descriptor(
    "configuration",
    "Configure the knowledge space retrieval models before importing documents.",
    "after_configuration",
    422,
    "configure_model",
  ),
  MODEL_CAPABILITY_MISMATCH: descriptor(
    "configuration",
    "The selected model does not support the required capability. Select a compatible model before retrying.",
    "after_configuration",
    422,
    "configure_model",
  ),
  MODEL_CONFIGURATION_STALE: descriptor(
    "conflict",
    "The model configuration changed while it was being validated. Try the operation again.",
    "automatic",
    409,
    "retry",
  ),
  MODEL_CREDENTIAL_INVALID: descriptor(
    "configuration",
    "The selected model credentials are invalid. Ask an administrator to update the model provider configuration.",
    "after_configuration",
    422,
    "configure_model",
  ),
  MODEL_CREDENTIAL_VALIDATION_UNAVAILABLE: descriptor(
    "dependency",
    "The selected model credentials could not be validated because the model service is temporarily unavailable.",
    "automatic",
    503,
    "retry",
  ),
  MODEL_IDENTITY_MISMATCH: descriptor(
    "configuration",
    "The model provider returned a different model than the one selected. Select or reconfigure the model before retrying.",
    "after_configuration",
    422,
    "configure_model",
  ),
  MODEL_PREFLIGHT_CANCELED: descriptor(
    "canceled",
    "Model validation was canceled.",
    "manual",
    409,
    "retry",
  ),
  MODEL_PREFLIGHT_FAILED: descriptor(
    "dependency",
    "The selected model could not be validated because the model service failed.",
    "automatic",
    503,
    "retry",
  ),
  MODEL_PREFLIGHT_TIMEOUT: descriptor(
    "timeout",
    "The selected model did not respond during validation. Try again later.",
    "automatic",
    503,
    "retry",
  ),
  MODEL_PREFLIGHT_UNAVAILABLE: descriptor(
    "dependency",
    "Model validation is temporarily unavailable. Try again later.",
    "automatic",
    503,
    "retry",
  ),
  MODEL_PROFILE_ACTIVATION_INCOMPLETE: descriptor(
    "configuration",
    "The knowledge space model configuration is incomplete. Configure the models before retrying.",
    "after_configuration",
    422,
    "configure_model",
  ),
  MODEL_PROFILE_ACTIVATION_PERMISSION_REQUIRED: descriptor(
    "authorization",
    "The model configuration could not be activated with the current permission.",
    "never",
    403,
    "contact_admin",
  ),
  MODEL_RUNTIME_FAILED: descriptor(
    "dependency",
    "The model service failed while processing the document.",
    "manual",
    502,
    "retry",
  ),
  MODEL_RUNTIME_TIMEOUT: descriptor(
    "timeout",
    "The model service timed out while processing the document.",
    "automatic",
    503,
    "retry",
  ),
  MODEL_RUNTIME_UNAVAILABLE: descriptor(
    "dependency",
    "The model service is temporarily unavailable.",
    "automatic",
    503,
    "retry",
  ),
  MODEL_SELECTION_NOT_FOUND: descriptor(
    "configuration",
    "The selected model is no longer available in this workspace. Select another model before retrying.",
    "after_configuration",
    422,
    "configure_model",
  ),
  RESEARCH_TASK_CAPABILITY_REVOKED: descriptor(
    "authorization",
    "Access to the knowledge space was revoked while the research task was running.",
    "never",
    403,
    "contact_admin",
  ),
  RESEARCH_TASK_DISPATCH_DEAD: descriptor(
    "dependency",
    "The research task could not be dispatched after repeated attempts.",
    "manual",
    503,
    "retry",
  ),
  RESEARCH_TASK_EXECUTION_ATTEMPTS_EXHAUSTED: descriptor(
    "dependency",
    "The research task failed after all automatic retry attempts.",
    "manual",
    503,
    "retry",
  ),
  RESEARCH_TASK_FAILED: descriptor(
    "internal",
    "The research task could not be completed. Try again, or contact an administrator with the error reference.",
    "manual",
    500,
    "contact_admin",
  ),
  RESEARCH_TASK_PERMISSION_SNAPSHOT_INVALID: descriptor(
    "authorization",
    "Access permissions changed while the research task was running.",
    "never",
    403,
    "contact_admin",
  ),
  RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID: descriptor(
    "internal",
    "The research task could not resume from its saved state.",
    "manual",
    500,
    "contact_admin",
  ),
  SOURCE_BULK_ACTION_FAILED: descriptor(
    "dependency",
    "The source bulk operation could not be completed.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_CREDENTIAL_CONFIG_INVALID: descriptor(
    "configuration",
    "The source credential configuration is invalid.",
    "after_configuration",
    422,
    "configure_source",
  ),
  SOURCE_CREDENTIAL_MUTATION_FAILED: descriptor(
    "dependency",
    "The source credential could not be updated.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_CREDENTIAL_TEST_FAILED: descriptor(
    "configuration",
    "The source credential could not be validated.",
    "after_configuration",
    422,
    "configure_source",
  ),
  SOURCE_CREDENTIAL_UNAVAILABLE: descriptor(
    "configuration",
    "The source credential is unavailable.",
    "after_configuration",
    422,
    "configure_source",
  ),
  SOURCE_DOCUMENT_COMPILATION_FAILED: descriptor(
    "dependency",
    "The source document could not be compiled.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_DOCUMENT_MATERIALIZATION_FAILED: descriptor(
    "dependency",
    "The source document could not be prepared for import.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED: descriptor(
    "dependency",
    "A changed source document cannot be replaced until durable source replacement is available.",
    "never",
    409,
    "contact_admin",
  ),
  SOURCE_ONLINE_DOCUMENT_CONFIG_INVALID: descriptor(
    "configuration",
    "The online-document source configuration is invalid.",
    "after_configuration",
    422,
    "configure_source",
  ),
  SOURCE_ONLINE_DOCUMENT_IMPORT_FAILED: descriptor(
    "dependency",
    "The online-document import could not be completed.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_ONLINE_DOCUMENT_PAGE_FETCH_FAILED: descriptor(
    "dependency",
    "A page from the online-document source could not be loaded.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_ONLINE_DOCUMENT_REQUEST_FAILED: descriptor(
    "dependency",
    "The online-document service is temporarily unavailable.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_ONLINE_DRIVE_CONFIG_INVALID: descriptor(
    "configuration",
    "The online-drive source configuration is invalid.",
    "after_configuration",
    422,
    "configure_source",
  ),
  SOURCE_ONLINE_DRIVE_FILE_DOWNLOAD_FAILED: descriptor(
    "dependency",
    "A file from the online-drive source could not be downloaded.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_ONLINE_DRIVE_IMPORT_FAILED: descriptor(
    "dependency",
    "The online-drive import could not be completed.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_ONLINE_DRIVE_REQUEST_FAILED: descriptor(
    "dependency",
    "The online-drive service is temporarily unavailable.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_OPERATION_FAILED: descriptor(
    "dependency",
    "The source operation could not be completed.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_SECRET_INTEGRITY_FAILED: descriptor(
    "internal",
    "The stored source credential failed its integrity check.",
    "never",
    500,
    "contact_admin",
  ),
  SOURCE_SECRET_REF_CONFLICT: descriptor(
    "conflict",
    "The source credential changed while it was being updated.",
    "manual",
    409,
    "retry",
  ),
  SOURCE_SYNC_FAILED: descriptor(
    "dependency",
    "The source sync could not be completed.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_WEBSITE_CRAWL_CONFIG_INVALID: descriptor(
    "configuration",
    "The website source configuration is invalid.",
    "after_configuration",
    422,
    "configure_source",
  ),
  SOURCE_WEBSITE_CRAWL_FAILED: descriptor(
    "dependency",
    "The website crawl could not be completed.",
    "manual",
    503,
    "retry",
  ),
  SOURCE_WORKFLOW_FAILED: descriptor(
    "dependency",
    "The source workflow could not be completed.",
    "manual",
    503,
    "retry",
  ),
  UPLOAD_INITIALIZATION_FAILED: descriptor(
    "dependency",
    "The file upload could not be initialized. Try uploading the file again.",
    "manual",
    503,
    "reupload",
  ),
  UPLOAD_INTEGRITY_MISMATCH: descriptor(
    "validation",
    "The uploaded file did not pass its integrity check. Upload the file again.",
    "never",
    422,
    "reupload",
  ),
} as const satisfies Record<string, KnowledgeFsErrorDescriptor>;

export type KnowledgeFsErrorCode = keyof typeof KNOWLEDGE_FS_ERROR_CATALOG;

export const KnowledgeFsErrorCodeValues = Object.keys(KNOWLEDGE_FS_ERROR_CATALOG) as [
  KnowledgeFsErrorCode,
  ...KnowledgeFsErrorCode[],
];

export interface KnowledgeFsErrorOptions {
  readonly action?: KnowledgeFsRecoveryAction | undefined;
  readonly category?: KnowledgeFsErrorCategory | undefined;
  readonly cause?: unknown;
  readonly code: string;
  readonly httpStatus?: number | undefined;
  readonly parameters?: Readonly<Record<string, KnowledgeFsFailureParameter>> | undefined;
  readonly publicMessage?: string | undefined;
  readonly retryPolicy?: KnowledgeFsRetryPolicy | undefined;
}

export class KnowledgeFsError extends Error {
  readonly action?: KnowledgeFsRecoveryAction | undefined;
  readonly category: KnowledgeFsErrorCategory;
  readonly code: KnowledgeFsErrorCode;
  readonly httpStatus: number;
  readonly parameters?: Readonly<Record<string, KnowledgeFsFailureParameter>> | undefined;
  readonly publicMessage: string;
  readonly retryPolicy: KnowledgeFsRetryPolicy;

  constructor(message: string, options: KnowledgeFsErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "KnowledgeFsError";
    const failure = knowledgeFsFailureForCode(options.code, {
      ...(options.action ? { action: options.action } : {}),
      ...(options.category ? { category: options.category } : {}),
      ...(options.parameters ? { parameters: options.parameters } : {}),
      ...(options.publicMessage ? { publicMessage: options.publicMessage } : {}),
      ...(options.retryPolicy ? { retryPolicy: options.retryPolicy } : {}),
    });
    this.action = failure.action;
    this.category = failure.category;
    this.code = failure.code;
    this.httpStatus = options.httpStatus ?? knowledgeFsErrorHttpStatus(failure.code);
    this.parameters = failure.parameters;
    this.publicMessage = failure.message;
    this.retryPolicy = failure.retryPolicy;
  }
}

export class KnowledgeFsValidationError extends KnowledgeFsError {
  constructor(
    message: string,
    options: { readonly cause?: unknown; readonly publicMessage?: string } = {},
  ) {
    super(message, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
      code: "KNOWLEDGE_FS_INVALID_REQUEST",
      httpStatus: 400,
      ...(options.publicMessage ? { publicMessage: options.publicMessage } : {}),
      retryPolicy: "never",
    });
    this.name = "KnowledgeFsValidationError";
  }
}

export class KnowledgeFsNotFoundError extends KnowledgeFsError {
  constructor(
    message: string,
    options: { readonly cause?: unknown; readonly publicMessage?: string } = {},
  ) {
    super(message, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
      code: "KNOWLEDGE_FS_NOT_FOUND",
      httpStatus: 404,
      ...(options.publicMessage ? { publicMessage: options.publicMessage } : {}),
      retryPolicy: "never",
    });
    this.name = "KnowledgeFsNotFoundError";
  }
}

export function knowledgeFsFailureForCode(
  code: string,
  options: {
    readonly action?: KnowledgeFsRecoveryAction | undefined;
    readonly category?: KnowledgeFsErrorCategory | undefined;
    readonly parameters?: Readonly<Record<string, KnowledgeFsFailureParameter>> | undefined;
    readonly publicMessage?: string | undefined;
    readonly retryPolicy?: KnowledgeFsRetryPolicy | undefined;
    readonly stage?: string | undefined;
    readonly traceId?: string | undefined;
  } = {},
): KnowledgeFsPublicFailure {
  const publicCode = publicKnowledgeFsErrorCode(code);
  const descriptor = descriptorForCode(publicCode);
  const parameters = safeFailureParameters(options.parameters);
  const stage = safePublicStage(options.stage);
  const traceId = safePublicTraceId(options.traceId);
  return {
    ...((options.action ?? descriptor.action)
      ? { action: options.action ?? descriptor.action }
      : {}),
    category: options.category ?? descriptor.category,
    code: publicCode,
    message: safePublicMessage(options.publicMessage) ?? descriptor.message,
    ...(parameters ? { parameters } : {}),
    retryPolicy: options.retryPolicy ?? descriptor.retryPolicy,
    ...(stage ? { stage } : {}),
    ...(traceId ? { traceId } : {}),
  };
}

export function knowledgeFsFailureFromError(
  error: unknown,
  context: { readonly stage?: string | undefined; readonly traceId?: string | undefined } = {},
): KnowledgeFsPublicFailure {
  if (error instanceof KnowledgeFsError) {
    return knowledgeFsFailureForCode(error.code, {
      ...(error.action ? { action: error.action } : {}),
      category: error.category,
      ...(error.parameters ? { parameters: error.parameters } : {}),
      publicMessage: error.publicMessage,
      retryPolicy: error.retryPolicy,
      ...context,
    });
  }
  const code = errorCode(error);
  if (code) {
    return knowledgeFsFailureForCode(code, context);
  }
  if (isAbortError(error)) {
    return knowledgeFsFailureForCode("MODEL_PREFLIGHT_CANCELED", context);
  }
  if (isTimeoutError(error)) {
    return knowledgeFsFailureForCode("KNOWLEDGE_FS_TIMEOUT", context);
  }
  if (error instanceof Error && error.name === "ZodError") {
    return knowledgeFsFailureForCode("KNOWLEDGE_FS_INVALID_REQUEST", context);
  }
  return knowledgeFsFailureForCode("KNOWLEDGE_FS_INTERNAL_ERROR", context);
}

export function knowledgeFsErrorHttpStatus(code: string): number {
  return descriptorForCode(publicKnowledgeFsErrorCode(code)).httpStatus;
}

export function isRegisteredKnowledgeFsErrorCode(code: string): boolean {
  const normalized = normalizeKnowledgeFsErrorCode(code);
  return isKnowledgeFsErrorCode(normalized);
}

export function knowledgeFsFailureAllowsManualRetry(
  failure: KnowledgeFsPublicFailure | undefined,
): boolean {
  return failure?.retryPolicy === "automatic" || failure?.retryPolicy === "manual";
}

function descriptor(
  category: KnowledgeFsErrorCategory,
  message: string,
  retryPolicy: KnowledgeFsRetryPolicy,
  httpStatus: number,
  action?: KnowledgeFsRecoveryAction,
): KnowledgeFsErrorDescriptor {
  return { ...(action ? { action } : {}), category, httpStatus, message, retryPolicy };
}

function descriptorForCode(code: string): KnowledgeFsErrorDescriptor {
  return (
    (KNOWLEDGE_FS_ERROR_CATALOG as Record<string, KnowledgeFsErrorDescriptor | undefined>)[code] ??
    internal
  );
}

function publicKnowledgeFsErrorCode(code: string): KnowledgeFsErrorCode {
  const normalized = normalizeKnowledgeFsErrorCode(code);
  if (isKnowledgeFsErrorCode(normalized)) return normalized;

  if (
    normalized.includes("AUTH") ||
    normalized.includes("PERMISSION") ||
    normalized.startsWith("CAPABILITY_") ||
    normalized.endsWith("_DENIED")
  ) {
    return "KNOWLEDGE_FS_ACCESS_DENIED";
  }
  if (normalized.endsWith("_NOT_FOUND")) return "KNOWLEDGE_FS_NOT_FOUND";
  if (normalized.includes("TIMEOUT")) return "KNOWLEDGE_FS_TIMEOUT";
  if (normalized.includes("RATE_LIMIT")) return "KNOWLEDGE_FS_RATE_LIMITED";
  if (
    normalized.includes("CONFLICT") ||
    normalized.includes("STALE") ||
    normalized.includes("CHANGED") ||
    normalized.includes("FENCE")
  ) {
    return "KNOWLEDGE_FS_CONFLICT";
  }
  if (normalized.startsWith("SOURCE_")) {
    return normalized.includes("CREDENTIAL") || normalized.includes("CONFIG")
      ? "SOURCE_CREDENTIAL_CONFIG_INVALID"
      : "SOURCE_OPERATION_FAILED";
  }
  if (normalized.startsWith("UPLOAD_")) return "UPLOAD_INITIALIZATION_FAILED";
  if (normalized.includes("PARSER") || normalized.includes("UNSTRUCTURED")) {
    return "DOCUMENT_PARSER_UNAVAILABLE";
  }
  if (normalized.startsWith("RESEARCH_")) return "RESEARCH_TASK_FAILED";
  if (normalized.startsWith("QUERY_")) return "KNOWLEDGE_FS_UNAVAILABLE";
  if (normalized.includes("METADATA")) return "KNOWLEDGE_FS_INVALID_REQUEST";
  if (normalized.startsWith("MODEL_") || normalized.startsWith("EMBEDDING_")) {
    if (normalized.includes("UNAVAILABLE")) return "MODEL_RUNTIME_UNAVAILABLE";
    return normalized.includes("CONFIG") ||
      normalized.includes("CREDENTIAL") ||
      normalized.includes("SELECTION") ||
      normalized.includes("CAPABILITY") ||
      normalized.includes("DIMENSION") ||
      normalized.includes("IDENTITY") ||
      normalized.includes("REQUIRED")
      ? "MODEL_PROFILE_ACTIVATION_INCOMPLETE"
      : "MODEL_RUNTIME_FAILED";
  }
  if (normalized.includes("INVALID")) {
    return "KNOWLEDGE_FS_INVALID_REQUEST";
  }
  if (normalized.includes("UNAVAILABLE")) return "KNOWLEDGE_FS_UNAVAILABLE";
  return "KNOWLEDGE_FS_INTERNAL_ERROR";
}

function isKnowledgeFsErrorCode(code: string): code is KnowledgeFsErrorCode {
  return Object.hasOwn(KNOWLEDGE_FS_ERROR_CATALOG, code);
}

function normalizeKnowledgeFsErrorCode(code: string): string {
  const normalized = code
    .trim()
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .toUpperCase()
    .slice(0, 128);
  const aliases: Readonly<Record<string, string>> = {
    DIFY_MODEL_RUNTIME_ABORTED: "MODEL_PREFLIGHT_CANCELED",
    DIFY_MODEL_RUNTIME_INPUT: "MODEL_RUNTIME_FAILED",
    DIFY_MODEL_RUNTIME_INVOCATION_FAILED: "MODEL_RUNTIME_FAILED",
    DIFY_MODEL_RUNTIME_REQUEST_FAILED: "MODEL_RUNTIME_UNAVAILABLE",
    DIFY_MODEL_RUNTIME_RESPONSE_INVALID: "MODEL_RUNTIME_FAILED",
    DIFY_MODEL_RUNTIME_RESPONSE_TOO_LARGE: "MODEL_RUNTIME_FAILED",
    DIFY_MODEL_RUNTIME_TIMEOUT: "MODEL_RUNTIME_TIMEOUT",
    DIFY_OBJECT_STORAGE_REQUEST_FAILED: "DOCUMENT_COMPILATION_RETRYABLE",
    METADATA_PREPARE_FAILED: "DOCUMENT_COMPILATION_FAILED",
    OBJECT_VERIFICATION_FAILED: "UPLOAD_INTEGRITY_MISMATCH",
    PROVIDER_INPUT: "DOCUMENT_PARSER_INPUT_INVALID",
    PROVIDER_RATE_LIMITED: "DOCUMENT_PARSER_RATE_LIMITED",
    PROVIDER_REQUEST_FAILED: "DOCUMENT_PARSER_UNAVAILABLE",
    PROVIDER_RESPONSE_INVALID: "DOCUMENT_PARSER_RESPONSE_INVALID",
    PROVIDER_TIMEOUT: "DOCUMENT_PARSER_TIMEOUT",
  };
  return aliases[normalized] ?? (normalized || "KNOWLEDGE_FS_INTERNAL_ERROR");
}

function safeFailureParameters(
  parameters: Readonly<Record<string, KnowledgeFsFailureParameter>> | undefined,
): Readonly<Record<string, KnowledgeFsFailureParameter>> | undefined {
  if (!parameters) return undefined;
  const safe: Record<string, KnowledgeFsFailureParameter> = {};
  const allowedKeys = new Set<string>(KnowledgeFsFailureParameterKeyValues);
  for (const [key, value] of Object.entries(parameters).slice(0, 8)) {
    if (!allowedKeys.has(key)) continue;
    if (typeof value === "string") {
      const bounded = boundedValue(value, 256);
      if (bounded) safe[key] = bounded;
      continue;
    }
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function safePublicMessage(message: string | undefined): string | undefined {
  return boundedValue(message, 1_024);
}

function safePublicStage(stage: string | undefined): string | undefined {
  const bounded = boundedValue(stage, 128);
  return bounded && /^[a-z][a-z0-9_.-]{0,127}$/u.test(bounded) ? bounded : undefined;
}

function safePublicTraceId(traceId: string | undefined): string | undefined {
  const bounded = boundedValue(traceId, 128);
  return bounded && /^[A-Za-z0-9._:-]{1,128}$/u.test(bounded) ? bounded : undefined;
}

function boundedValue(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code : undefined;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === "AbortError" || /abort|cancel/iu.test(error.name))
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timeout|timed out/iu.test(`${error.name} ${error.message}`);
}
