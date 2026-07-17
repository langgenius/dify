type ValueOf<T> = T[keyof T]

export const ContactImProvider = {
  DingTalk: 'dingtalk',
  Feishu: 'feishu',
  Slack: 'slack',
} as const

export type ContactImProvider = ValueOf<typeof ContactImProvider>

export const ContactImAuthMode = {
  Credentials: 'credentials',
  OAuth: 'oauth',
} as const

export type ContactImAuthMode = ValueOf<typeof ContactImAuthMode>

export const ContactImProviderAvailability = {
  Available: 'available',
  Unavailable: 'unavailable',
} as const

export type ContactImProviderAvailability = ValueOf<typeof ContactImProviderAvailability>

export const ContactImConnectionStatus = {
  CallbackError: 'callback_error',
  Configured: 'configured',
  Connected: 'connected',
  ConnectionError: 'connection_error',
  NotConfigured: 'not_configured',
  PermissionIssue: 'permission_issue',
} as const

export type ContactImConnectionStatus = ValueOf<typeof ContactImConnectionStatus>

export const ContactImSyncStatus = {
  Failure: 'failure',
  PartialSuccess: 'partial_success',
  Queued: 'queued',
  Running: 'running',
  Success: 'success',
} as const

export type ContactImSyncStatus = ValueOf<typeof ContactImSyncStatus>

export const ContactImSyncResult = {
  CreatedBinding: 'created_binding',
  Failed: 'failed',
  Matched: 'matched',
  Skipped: 'skipped',
  Unmatched: 'unmatched',
  UpdatedBinding: 'updated_binding',
} as const

export type ContactImSyncResult = ValueOf<typeof ContactImSyncResult>

export const ContactImProviderField = {
  AppId: 'appId',
  ClientId: 'clientId',
  Secret: 'secret',
  TenantId: 'tenantId',
} as const

export type ContactImProviderField = ValueOf<typeof ContactImProviderField>

export const ContactImStatusReason = {
  CallbackMismatch: 'callback_mismatch',
  MissingDirectoryPermission: 'missing_directory_permission',
  ProviderRequestFailed: 'provider_request_failed',
} as const

export type ContactImStatusReason = ValueOf<typeof ContactImStatusReason>

export const ContactImUnavailableReason = {
  DeploymentUnsupported: 'deployment_unsupported',
  NotReleased: 'not_released',
} as const

export type ContactImUnavailableReason = ValueOf<typeof ContactImUnavailableReason>

export const ContactImSafeReason = {
  ContactUpdateFailed: 'contact_update_failed',
  DuplicateIdentity: 'duplicate_identity',
  MissingEmail: 'missing_email',
  NoMatchingContact: 'no_matching_contact',
  ProviderRequestFailed: 'provider_request_failed',
} as const

export type ContactImSafeReason = ValueOf<typeof ContactImSafeReason>

export const ContactImRepositoryErrorCode = {
  ActiveProviderExists: 'active_provider_exists',
  DetailLoadFailed: 'detail_load_failed',
  IntegrationLoadFailed: 'integration_load_failed',
  InvalidCommand: 'invalid_command',
  MutationFailed: 'mutation_failed',
  NoPermission: 'no_permission',
  PageLoadFailed: 'page_load_failed',
  PermissionLoadFailed: 'permission_load_failed',
  ProviderLoadFailed: 'provider_load_failed',
  ProviderUnavailable: 'provider_unavailable',
  RequiredFieldsMissing: 'required_fields_missing',
  SyncAlreadyRunning: 'sync_already_running',
  SyncNotAllowed: 'sync_not_allowed',
  SyncRunNotFound: 'sync_run_not_found',
} as const

export type ContactImRepositoryErrorCode = ValueOf<typeof ContactImRepositoryErrorCode>

export class ContactImRepositoryError extends Error {
  code: ContactImRepositoryErrorCode

  constructor(code: ContactImRepositoryErrorCode) {
    super(code)
    this.name = 'ContactImRepositoryError'
    this.code = code
  }

  toJSON() {
    return {
      code: this.code,
      name: this.name,
    }
  }
}

export type ContactImProviderCapabilities = {
  directorySync: boolean
}

export type ContactImProviderFieldDefinition = {
  field: ContactImProviderField
  required: boolean
}

export type ContactImProviderDefinition = {
  authMode: ContactImAuthMode
  availability: ContactImProviderAvailability
  callbackUrl: string | null
  capabilities: ContactImProviderCapabilities
  displayName: string
  provider: ContactImProvider
  requiredFields: ContactImProviderFieldDefinition[]
  unavailableReason: ContactImUnavailableReason | null
}

export type ContactImSyncCounts = Record<ContactImSyncResult, number>

export type ContactImSyncRunView = {
  completedAt: string | null
  counts: ContactImSyncCounts
  durationMs: number | null
  id: string
  safeError: ContactImSafeReason | null
  startedAt: string
  startedBy: string
  status: ContactImSyncStatus
}

export type ContactImIntegrationView = {
  canManage: boolean
  capabilities: ContactImProviderCapabilities
  displayIdentifier: string | null
  lastCheckedAt: string | null
  lastSync: ContactImSyncRunView | null
  organizationId: string
  provider: ContactImProvider | null
  secretConfigured: boolean
  status: ContactImConnectionStatus
  statusReason: ContactImStatusReason | null
}

export type ContactImPlatformIdentityView = {
  displayName: string | null
  email: string | null
  platformUserId: string | null
}

export type ContactImMatchedContactView = {
  email: string | null
  id: string
  name: string
}

export type ContactImSyncItemView = {
  id: string
  matchedContact: ContactImMatchedContactView | null
  platformIdentity: ContactImPlatformIdentityView
  result: ContactImSyncResult
  safeReason: ContactImSafeReason | null
}

export type ContactImPage<T> = {
  items: T[]
  nextCursor: string | null
}

export type SaveContactImCredentialsCommand = {
  organizationId: string
  provider: ContactImProvider
  replaceActiveProvider: boolean
  retainSecret: boolean
  secret?: string
  values: Partial<Record<Exclude<ContactImProviderField, 'secret'>, string>>
}

export type AuthorizeContactImProviderCommand = {
  organizationId: string
  provider: ContactImProvider
  replaceActiveProvider: boolean
}

export type ContactImOrganizationCommand = {
  organizationId: string
}

export type ListContactImSyncItemsInput = {
  cursor?: string
  pageSize?: number
  result?: ContactImSyncResult
  runId: string
}
