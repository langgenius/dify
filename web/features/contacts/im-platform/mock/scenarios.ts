import type { ContactsImPlatformOrganizationContext } from '../context'
import type {
  ContactImIntegrationView,
  ContactImProviderDefinition,
  ContactImSafeReason,
  ContactImSyncCounts,
  ContactImSyncItemView,
  ContactImSyncRunView,
  ContactImSyncStatus,
} from '../types'
import {
  ContactImAuthMode,
  ContactImConnectionStatus,
  ContactImProvider,
  ContactImProviderAvailability,
  ContactImProviderField,
  ContactImStatusReason,
  ContactImSyncResult,
  ContactImUnavailableReason,
  ContactImSafeReason as SafeReason,
  ContactImSyncStatus as SyncStatus,
} from '../types'

type ValueOf<T> = T[keyof T]

export const ContactImMockScenario = {
  ActiveSync: 'active_sync',
  AuthorizationFailure: 'authorization_failure',
  CallbackError: 'callback_error',
  Configured: 'configured',
  Connected: 'connected',
  ConnectionError: 'connection_error',
  ConnectionTestFailure: 'connection_test_failure',
  DetailFailure: 'detail_failure',
  DisconnectFailure: 'disconnect_failure',
  LoadFailure: 'load_failure',
  Loading: 'loading',
  NoPermission: 'no_permission',
  PageFailure: 'page_failure',
  PaginatedResults: 'paginated_results',
  PermissionIssue: 'permission_issue',
  PermissionLoadFailure: 'permission_load_failure',
  ProviderUnavailable: 'provider_unavailable',
  SaveFailure: 'save_failure',
  SyncFailure: 'sync_failure',
  SyncPartialSuccess: 'sync_partial_success',
  SyncStartFailure: 'sync_start_failure',
  SyncSuccess: 'sync_success',
  NotConfigured: 'not_configured',
} as const

export type ContactImMockScenario = ValueOf<typeof ContactImMockScenario>

export type ContactImMockFailurePlan = {
  authorization: boolean
  connectionTest: boolean
  detailRunId: string | null
  disconnect: boolean
  integrationLoad: boolean
  pageCursor: string | null
  permissionLoad: boolean
  providerLoad: boolean
  save: boolean
  syncStart: boolean
}

export type ContactImMockTransitionFinal = {
  items: ContactImSyncItemView[]
  safeError: ContactImSafeReason | null
  status: Extract<ContactImSyncStatus, 'success' | 'partial_success' | 'failure'>
}

export type ContactImMockScenarioSeed = {
  failures: ContactImMockFailurePlan
  integration: ContactImIntegrationView
  itemsByRun: Record<string, ContactImSyncItemView[]>
  nextSyncNumber: number
  organization: ContactsImPlatformOrganizationContext
  pendingInitialLoad: boolean
  providers: ContactImProviderDefinition[]
  runs: Record<string, ContactImSyncRunView>
  scenario: ContactImMockScenario
  transitionFinals: Record<string, ContactImMockTransitionFinal>
}

export const createEmptyContactImSyncCounts = (): ContactImSyncCounts => ({
  [ContactImSyncResult.CreatedBinding]: 0,
  [ContactImSyncResult.Failed]: 0,
  [ContactImSyncResult.Matched]: 0,
  [ContactImSyncResult.Skipped]: 0,
  [ContactImSyncResult.Unmatched]: 0,
  [ContactImSyncResult.UpdatedBinding]: 0,
})

export const countContactImSyncItems = (items: ContactImSyncItemView[]): ContactImSyncCounts => {
  const counts = createEmptyContactImSyncCounts()

  for (const item of items) counts[item.result] += 1

  return counts
}

const clone = <T>(value: T): T => structuredClone(value)

const createProviderDefinitions = (): ContactImProviderDefinition[] => [
  {
    authMode: ContactImAuthMode.Credentials,
    availability: ContactImProviderAvailability.Available,
    callbackUrl: 'https://example.dify.test/contacts/im/slack/callback',
    capabilities: { directorySync: true },
    displayName: 'Slack',
    provider: ContactImProvider.Slack,
    requiredFields: [
      { field: ContactImProviderField.AppId, required: true },
      { field: ContactImProviderField.Secret, required: true },
    ],
    unavailableReason: null,
  },
  {
    authMode: ContactImAuthMode.OAuth,
    availability: ContactImProviderAvailability.Available,
    callbackUrl: 'https://example.dify.test/contacts/im/feishu/callback',
    capabilities: { directorySync: true },
    displayName: 'Feishu',
    provider: ContactImProvider.Feishu,
    requiredFields: [],
    unavailableReason: null,
  },
  {
    authMode: ContactImAuthMode.Credentials,
    availability: ContactImProviderAvailability.Available,
    callbackUrl: 'https://example.dify.test/contacts/im/dingtalk/callback',
    capabilities: { directorySync: false },
    displayName: 'DingTalk',
    provider: ContactImProvider.DingTalk,
    requiredFields: [
      { field: ContactImProviderField.ClientId, required: true },
      { field: ContactImProviderField.Secret, required: true },
    ],
    unavailableReason: null,
  },
]

const createBaseIntegration = (
  organization: ContactsImPlatformOrganizationContext,
): ContactImIntegrationView => ({
  canManage: organization.canManage,
  capabilities: { directorySync: false },
  displayIdentifier: null,
  lastCheckedAt: null,
  lastSync: null,
  organizationId: organization.organizationId,
  provider: null,
  secretConfigured: false,
  status: ContactImConnectionStatus.NotConfigured,
  statusReason: null,
})

const createFailurePlan = (): ContactImMockFailurePlan => ({
  authorization: false,
  connectionTest: false,
  detailRunId: null,
  disconnect: false,
  integrationLoad: false,
  pageCursor: null,
  permissionLoad: false,
  providerLoad: false,
  save: false,
  syncStart: false,
})

const createBaseSeed = (
  organization: ContactsImPlatformOrganizationContext,
  scenario: ContactImMockScenario,
): ContactImMockScenarioSeed => ({
  failures: createFailurePlan(),
  integration: createBaseIntegration(organization),
  itemsByRun: {},
  nextSyncNumber: 1,
  organization: clone(organization),
  pendingInitialLoad: false,
  providers: createProviderDefinitions(),
  runs: {},
  scenario,
  transitionFinals: {},
})

const configureSlack = (
  seed: ContactImMockScenarioSeed,
  status: Exclude<ContactImIntegrationView['status'], 'not_configured'>,
) => {
  const slack = seed.providers.find((provider) => provider.provider === ContactImProvider.Slack)

  if (!slack) throw new Error('Slack provider definition is required')

  seed.integration = {
    ...seed.integration,
    capabilities: clone(slack.capabilities),
    displayIdentifier: 'A012••••89',
    lastCheckedAt: '2026-07-17T05:42:00.000Z',
    provider: ContactImProvider.Slack,
    secretConfigured: true,
    status,
    statusReason: null,
  }
}

const createItem = (
  id: string,
  result: ContactImSyncItemView['result'],
  options: {
    matched?: boolean
    missingEmail?: boolean
    reason?: ContactImSafeReason | null
  } = {},
): ContactImSyncItemView => ({
  id,
  matchedContact:
    options.matched === false
      ? null
      : {
          email: `contact-${id}@example.test`,
          id: `contact-${id}`,
          name: `Contact ${id}`,
        },
  platformIdentity: {
    displayName: `Member ${id}`,
    email: options.missingEmail ? null : `member-${id}@example.test`,
    platformUserId: `platform-${id}`,
  },
  result,
  safeReason: options.reason ?? null,
})

const createSuccessItems = (): ContactImSyncItemView[] => [
  createItem('matched-1', ContactImSyncResult.Matched),
  createItem('created-1', ContactImSyncResult.CreatedBinding),
  createItem('updated-1', ContactImSyncResult.UpdatedBinding),
]

const createPartialItems = (): ContactImSyncItemView[] => [
  ...createSuccessItems(),
  createItem('unmatched-1', ContactImSyncResult.Unmatched, {
    matched: false,
    reason: SafeReason.NoMatchingContact,
  }),
  createItem('skipped-1', ContactImSyncResult.Skipped, {
    matched: false,
    missingEmail: true,
    reason: SafeReason.MissingEmail,
  }),
  createItem('failed-1', ContactImSyncResult.Failed, {
    matched: false,
    reason: SafeReason.ContactUpdateFailed,
  }),
]

const createRun = (
  id: string,
  status: ContactImSyncStatus,
  items: ContactImSyncItemView[],
  safeError: ContactImSafeReason | null = null,
): ContactImSyncRunView => ({
  completedAt:
    status === SyncStatus.Queued || status === SyncStatus.Running
      ? null
      : '2026-07-17T06:02:04.000Z',
  counts: countContactImSyncItems(items),
  durationMs: status === SyncStatus.Queued || status === SyncStatus.Running ? null : 124000,
  id,
  safeError,
  startedAt: '2026-07-17T06:00:00.000Z',
  startedBy: 'Workspace admin',
  status,
})

const addCompletedRun = (
  seed: ContactImMockScenarioSeed,
  id: string,
  status: Extract<ContactImSyncStatus, 'success' | 'partial_success' | 'failure'>,
  items: ContactImSyncItemView[],
  safeError: ContactImSafeReason | null = null,
) => {
  const run = createRun(id, status, items, safeError)
  seed.itemsByRun[id] = clone(items)
  seed.runs[id] = run
  seed.integration.lastSync = clone(run)
}

const addActiveRun = (seed: ContactImMockScenarioSeed) => {
  const id = 'mock-active-sync'
  const run = createRun(id, SyncStatus.Queued, [])
  seed.itemsByRun[id] = []
  seed.runs[id] = run
  seed.transitionFinals[id] = {
    items: createPartialItems(),
    safeError: null,
    status: SyncStatus.PartialSuccess,
  }
}

const assertCountAgreement = (run: ContactImSyncRunView, items: ContactImSyncItemView[]) => {
  const actual = countContactImSyncItems(items)

  for (const result of Object.values(ContactImSyncResult)) {
    if (run.counts[result] !== actual[result])
      throw new Error(`Sync summary counts do not match detail items for run ${run.id}`)
  }
}

export const validateContactImMockScenarioSeed = (seed: ContactImMockScenarioSeed) => {
  const hasProvider = seed.integration.provider !== null
  const isConfigured = seed.integration.status !== ContactImConnectionStatus.NotConfigured

  if (hasProvider !== isConfigured)
    throw new Error('Integration provider and connection status are inconsistent')

  for (const [runId, run] of Object.entries(seed.runs))
    assertCountAgreement(run, seed.itemsByRun[runId] ?? [])

  for (const [runId, final] of Object.entries(seed.transitionFinals)) {
    const finalRun = createRun(runId, final.status, final.items, final.safeError)
    assertCountAgreement(finalRun, final.items)
  }

  if (seed.integration.lastSync && !seed.runs[seed.integration.lastSync.id])
    throw new Error('Latest sync must reference a run in the same scenario')
}

export const getContactImMockScenarioSeed = (
  scenario: ContactImMockScenario,
  organization: ContactsImPlatformOrganizationContext,
): ContactImMockScenarioSeed => {
  const seed = createBaseSeed(organization, scenario)

  switch (scenario) {
    case ContactImMockScenario.Loading:
      seed.pendingInitialLoad = true
      break
    case ContactImMockScenario.LoadFailure:
      seed.failures.integrationLoad = true
      break
    case ContactImMockScenario.PermissionLoadFailure:
      seed.failures.permissionLoad = true
      break
    case ContactImMockScenario.NoPermission:
      seed.integration.canManage = false
      break
    case ContactImMockScenario.ProviderUnavailable: {
      const provider = seed.providers.find(
        (definition) => definition.provider === ContactImProvider.DingTalk,
      )
      if (provider) {
        provider.availability = ContactImProviderAvailability.Unavailable
        provider.unavailableReason = ContactImUnavailableReason.DeploymentUnsupported
      }
      break
    }
    case ContactImMockScenario.NotConfigured:
      break
    case ContactImMockScenario.Configured:
      configureSlack(seed, ContactImConnectionStatus.Configured)
      break
    case ContactImMockScenario.Connected:
      configureSlack(seed, ContactImConnectionStatus.Connected)
      break
    case ContactImMockScenario.PermissionIssue:
      configureSlack(seed, ContactImConnectionStatus.PermissionIssue)
      seed.integration.statusReason = ContactImStatusReason.MissingDirectoryPermission
      break
    case ContactImMockScenario.CallbackError:
      configureSlack(seed, ContactImConnectionStatus.CallbackError)
      seed.integration.statusReason = ContactImStatusReason.CallbackMismatch
      break
    case ContactImMockScenario.ConnectionError:
      configureSlack(seed, ContactImConnectionStatus.ConnectionError)
      seed.integration.statusReason = ContactImStatusReason.ProviderRequestFailed
      break
    case ContactImMockScenario.SaveFailure:
      seed.failures.save = true
      break
    case ContactImMockScenario.AuthorizationFailure:
      seed.failures.authorization = true
      break
    case ContactImMockScenario.ConnectionTestFailure:
      configureSlack(seed, ContactImConnectionStatus.Configured)
      seed.failures.connectionTest = true
      break
    case ContactImMockScenario.DisconnectFailure:
      configureSlack(seed, ContactImConnectionStatus.Connected)
      seed.failures.disconnect = true
      break
    case ContactImMockScenario.SyncStartFailure:
      configureSlack(seed, ContactImConnectionStatus.Connected)
      seed.failures.syncStart = true
      break
    case ContactImMockScenario.ActiveSync:
      configureSlack(seed, ContactImConnectionStatus.Connected)
      addActiveRun(seed)
      break
    case ContactImMockScenario.SyncSuccess:
      configureSlack(seed, ContactImConnectionStatus.Connected)
      addCompletedRun(seed, 'mock-sync-success', SyncStatus.Success, createSuccessItems())
      break
    case ContactImMockScenario.SyncPartialSuccess:
      configureSlack(seed, ContactImConnectionStatus.Connected)
      addCompletedRun(seed, 'mock-sync-partial', SyncStatus.PartialSuccess, createPartialItems())
      break
    case ContactImMockScenario.SyncFailure:
      configureSlack(seed, ContactImConnectionStatus.Connected)
      addCompletedRun(
        seed,
        'mock-sync-failure',
        SyncStatus.Failure,
        [],
        SafeReason.ProviderRequestFailed,
      )
      break
    case ContactImMockScenario.DetailFailure:
      configureSlack(seed, ContactImConnectionStatus.Connected)
      addCompletedRun(
        seed,
        'mock-sync-detail-failure',
        SyncStatus.PartialSuccess,
        createPartialItems(),
      )
      seed.failures.detailRunId = 'mock-sync-detail-failure'
      break
    case ContactImMockScenario.PaginatedResults: {
      configureSlack(seed, ContactImConnectionStatus.Connected)
      const items = [
        ...createPartialItems(),
        createItem('unmatched-2', ContactImSyncResult.Unmatched, {
          matched: false,
          reason: SafeReason.NoMatchingContact,
        }),
        createItem('matched-2', ContactImSyncResult.Matched),
      ]
      addCompletedRun(seed, 'mock-sync-paginated', SyncStatus.PartialSuccess, items)
      break
    }
    case ContactImMockScenario.PageFailure:
      configureSlack(seed, ContactImConnectionStatus.Connected)
      addCompletedRun(
        seed,
        'mock-sync-page-failure',
        SyncStatus.PartialSuccess,
        createPartialItems(),
      )
      seed.failures.pageCursor = '2'
      break
  }

  validateContactImMockScenarioSeed(seed)
  return clone(seed)
}

export const createDefaultTransitionFinal = (): ContactImMockTransitionFinal => ({
  items: createPartialItems(),
  safeError: null,
  status: SyncStatus.PartialSuccess,
})
