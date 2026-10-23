import type {
  ChannelSummary,
  EmailChannelDetailResponse,
  EmailProviderCredentialsUpdateInputWritable,
  EmailProviderCredentialsWritable,
  ImChannelDetailResponse,
  ImProviderCredentialsInputWritable,
  ImProviderCredentialsUpdateInputWritable,
  UnchangedInput,
} from '@dify/contracts/api/console/workspace/types.gen'
import type { ImSyncResultItem, ImSyncRun } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ContactsImPlatformOrganizationContext } from './context'
import type {
  AuthorizeContactImProviderCommand,
  ContactImIntegrationView,
  ContactImOrganizationCommand,
  ContactImPage,
  ContactImProvider,
  ContactImProviderCommand,
  ContactImProviderDefinition,
  ContactImProviderField,
  ContactImProviderFieldDefinition,
  ContactImSyncItemView,
  ContactImSyncRunView,
  ListContactImSyncItemsInput,
  SaveContactImCredentialsCommand,
  TestContactImConnectionCommand,
} from './types'
import { zChannelConflictResponse } from '@dify/contracts/api/console/workspace/zod.gen'
import { z } from 'zod'
import { consoleClient } from '@/service/console'
import {
  ContactImRepositoryError,
  ContactImRepositoryErrorCode,
  ContactImSyncResult,
  ContactImSyncStatus,
} from './types'

export type ContactImPlatformRepository = {
  authorizeProvider: (
    command: AuthorizeContactImProviderCommand,
  ) => Promise<ContactImIntegrationView>
  disconnect: (command: ContactImProviderCommand) => Promise<ContactImIntegrationView[]>
  getActiveSync: (organizationId: string) => Promise<ContactImSyncRunView | null>
  getIntegrations: (organizationId: string) => Promise<ContactImIntegrationView[]>
  getProviderDefinitions: (organizationId: string) => Promise<ContactImProviderDefinition[]>
  getSyncItems: (
    input: ListContactImSyncItemsInput,
  ) => Promise<ContactImPage<ContactImSyncItemView>>
  getSyncRun: (runId: string) => Promise<ContactImSyncRunView>
  queryKey: string
  saveCredentials: (command: SaveContactImCredentialsCommand) => Promise<ContactImIntegrationView>
  startSync: (command: ContactImOrganizationCommand) => Promise<ContactImSyncRunView>
  testConnection: (command: TestContactImConnectionCommand) => Promise<ContactImIntegrationView>
}

const syncReportResults = [
  ContactImSyncResult.Added,
  ContactImSyncResult.NotMatched,
  ContactImSyncResult.Failed,
  ContactImSyncResult.Removed,
  ContactImSyncResult.Skipped,
]

/** Export a completed run in full, refusing stale runs or incomplete result pages. */
export async function loadContactImSyncReport(
  repository: Pick<ContactImPlatformRepository, 'getSyncRun' | 'getSyncItems'>,
  runId: string,
) {
  const run = await repository.getSyncRun(runId)
  if (run.status === ContactImSyncStatus.Queued || run.status === ContactImSyncStatus.Running)
    throw new ContactImRepositoryError(ContactImRepositoryErrorCode.SyncNotAllowed)

  const items: ContactImSyncItemView[] = []
  const itemIds = new Set<string>()
  for (const result of syncReportResults) {
    let cursor: string | undefined
    const cursors = new Set<string>()
    let count = 0
    do {
      const page = await repository.getSyncItems({ runId: run.id, result, cursor, pageSize: 20 })
      for (const item of page.items) {
        if (item.result !== result || itemIds.has(item.id))
          throw new ContactImRepositoryError(ContactImRepositoryErrorCode.PageLoadFailed)
        itemIds.add(item.id)
        items.push(item)
        count += 1
      }
      if (page.nextCursor && (cursors.has(page.nextCursor) || page.items.length === 0))
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.PageLoadFailed)
      if (page.nextCursor) cursors.add(page.nextCursor)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    if (count !== (run.counts[result] ?? 0))
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.PageLoadFailed)
  }

  const current = await repository.getSyncRun(run.id)
  if (
    current.id !== run.id ||
    current.status !== run.status ||
    current.completedAt !== run.completedAt ||
    syncReportResults.some((result) => current.counts[result] !== run.counts[result])
  )
    throw new ContactImRepositoryError(ContactImRepositoryErrorCode.SyncRunNotFound)

  return { run, items }
}

const apiProviderNames = {
  ding_talk: 'dingtalk',
  resend: 'email',
  feishu: 'feishu',
  lark: 'lark',
  ms_teams: 'ms_teams',
  slack: 'slack',
  we_com: 'we_com',
} as const

const toContactImSyncRunView = (run: ImSyncRun): ContactImSyncRunView => ({
  completedAt: run.finished_at == null ? null : new Date(run.finished_at * 1000).toISOString(),
  counts: run.result_counts,
  durationMs:
    run.started_at == null || run.finished_at == null
      ? null
      : (run.finished_at - run.started_at) * 1000,
  errorMessage: run.error_message ?? null,
  id: run.id,
  provider: apiProviderNames[run.provider],
  safeError: null,
  startedAt: run.started_at == null ? null : new Date(run.started_at * 1000).toISOString(),
  startedBy: null,
  status:
    run.status === 'succeeded'
      ? ContactImSyncStatus.Success
      : run.status === 'failed'
        ? ContactImSyncStatus.Failure
        : run.status,
})

const toContactImSyncItemView = ({ id, result }: ImSyncResultItem): ContactImSyncItemView => {
  const contact = 'contact' in result ? result.contact : null
  const entry = result.type === 'removed' ? result.last_known_identity : result.entry

  return {
    id,
    matchedContact: contact
      ? { id: contact.id, name: contact.name, email: null, avatarUrl: contact.avatar_url }
      : null,
    platformIdentity: {
      displayName: entry?.display_name ?? null,
      email: entry?.email ?? null,
      platformUserId: entry?.provider_user_id ?? null,
    },
    reason: 'reason' in result ? result.reason : null,
    result: result.type,
    safeReason: null,
  }
}

/** The server exposes the latest run only; run IDs guard against showing another run's results. */
export function createContactImSyncApi(
  workspaceId: string,
  client: Pick<typeof consoleClient.workspaces.current.humanInput, 'imSyncRuns'> = consoleClient
    .workspaces.current.humanInput,
): Pick<
  ContactImPlatformRepository,
  'getActiveSync' | 'getSyncRun' | 'getSyncItems' | 'startSync'
> {
  const getLatest = async () => {
    if (!workspaceId) throw new ContactImRepositoryError(ContactImRepositoryErrorCode.NoPermission)

    try {
      const response = await client.imSyncRuns.latest.get(undefined, { context: { silent: true } })
      return toContactImSyncRunView(response.run)
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404)
        return null
      throw error
    }
  }
  const getSyncRun = async (runId: string) => {
    const run = await getLatest()
    if (!run || (runId !== 'latest' && run.id !== runId))
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.SyncRunNotFound)
    return run
  }

  return {
    getActiveSync: getLatest,
    getSyncRun,
    async getSyncItems({ cursor, pageSize = 20, result = ContactImSyncResult.Added, runId }) {
      if (
        result !== ContactImSyncResult.Added &&
        result !== ContactImSyncResult.NotMatched &&
        result !== ContactImSyncResult.Removed &&
        result !== ContactImSyncResult.Failed &&
        result !== ContactImSyncResult.Skipped
      )
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)

      const page = cursor ? Number(cursor) : 1
      if (!Number.isInteger(page) || page < 1)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)

      const run = await getSyncRun(runId)
      const response = await client.imSyncRuns.latest.results.get(
        {
          query: { result, page, limit: pageSize },
        },
        { context: { silent: true } },
      )
      await getSyncRun(run.id)
      return {
        items: response.data.map(toContactImSyncItemView),
        nextCursor:
          response.page * response.limit < response.total ? String(response.page + 1) : null,
      }
    },
    async startSync() {
      if (!workspaceId)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.NoPermission)
      const response = await client.imSyncRuns.post(undefined, { context: { silent: true } })
      return toContactImSyncRunView(response.run)
    },
  }
}

const providerMetadata: Record<
  ContactImProvider,
  { name: string; fields: ContactImProviderFieldDefinition[] }
> = {
  email: {
    name: 'Email',
    fields: [
      { field: 'senderEmail', required: true },
      { field: 'senderName', required: true },
      { field: 'secret', required: true, secret: true },
    ],
  },
  feishu: {
    name: 'Feishu',
    fields: [
      { field: 'appId', required: true },
      { field: 'secret', required: true, secret: true },
      { field: 'verificationToken', required: false, secret: true },
      { field: 'encryptKey', required: false, secret: true },
    ],
  },
  lark: {
    name: 'Lark',
    fields: [
      { field: 'appId', required: true },
      { field: 'secret', required: true, secret: true },
      { field: 'verificationToken', required: false, secret: true },
      { field: 'encryptKey', required: false, secret: true },
    ],
  },
  slack: {
    name: 'Slack',
    fields: [
      { field: 'clientId', required: true },
      { field: 'secret', required: true, secret: true },
      { field: 'signingSecret', required: true, secret: true },
      { field: 'botToken', required: true, secret: true },
      { field: 'appToken', required: false, secret: true },
    ],
  },
  dingtalk: {
    name: 'DingTalk',
    fields: [
      { field: 'corpId', required: true },
      { field: 'clientId', required: true },
      { field: 'secret', required: true, secret: true },
    ],
  },
  ms_teams: {
    name: 'Microsoft Teams',
    fields: [
      { field: 'tenantId', required: true },
      { field: 'clientId', required: true },
      { field: 'secret', required: true, secret: true },
    ],
  },
  we_com: {
    name: 'WeCom',
    fields: [
      { field: 'corpId', required: true },
      { field: 'agentId', required: true },
      { field: 'secret', required: true, secret: true },
    ],
  },
}

function validateClearedFields(command: TestContactImConnectionCommand) {
  for (const field of command.clearedFields ?? []) {
    const definition = providerMetadata[command.provider].fields.find(
      (item) => item.field === field,
    )
    if (!definition || definition.required)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)
  }
}

function createCredentialsFor(
  command: TestContactImConnectionCommand,
): EmailProviderCredentialsWritable | ImProviderCredentialsInputWritable {
  validateClearedFields(command)
  const required = (field: ContactImProviderField) => {
    const value = (field === 'secret' ? command.secret : command.values[field])?.trim()
    if (!value)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.RequiredFieldsMissing)
    return value
  }
  const optional = (field: Exclude<ContactImProviderField, 'secret'>) =>
    command.clearedFields?.includes(field) ? null : command.values[field]?.trim() || null
  switch (command.provider) {
    case 'email':
      return {
        provider: 'resend',
        sender_email: required('senderEmail'),
        sender_name: required('senderName'),
        api_key: required('secret'),
      }
    case 'feishu':
    case 'lark':
      return {
        provider: command.provider,
        app_id: required('appId'),
        app_secret: required('secret'),
        encrypt_key: optional('encryptKey'),
        verification_token: optional('verificationToken'),
      }
    case 'slack':
      return {
        provider: 'slack',
        client_id: required('clientId'),
        client_secret: required('secret'),
        signing_secret: required('signingSecret'),
        bot_token: required('botToken'),
        app_token: optional('appToken'),
      }
    case 'dingtalk':
      return {
        provider: 'ding_talk',
        corp_id: required('corpId'),
        client_id: required('clientId'),
        client_secret: required('secret'),
      }
    case 'ms_teams':
      return {
        provider: 'ms_teams',
        tenant_id: required('tenantId'),
        client_id: required('clientId'),
        client_secret: required('secret'),
      }
    case 'we_com':
      return {
        provider: 'we_com',
        corp_id: required('corpId'),
        agent_id: required('agentId'),
        secret: required('secret'),
      }
  }
}

function updateCredentialsFor(
  command: TestContactImConnectionCommand,
): EmailProviderCredentialsUpdateInputWritable | ImProviderCredentialsUpdateInputWritable {
  validateClearedFields(command)
  const unchanged: UnchangedInput = { type: 'unchanged' }
  const value = (field: ContactImProviderField) =>
    (field === 'secret' ? command.secret : command.values[field])?.trim() || unchanged
  const optional = (field: Exclude<ContactImProviderField, 'secret'>) =>
    command.clearedFields?.includes(field) ? null : value(field)

  switch (command.provider) {
    case 'email':
      return {
        provider: 'resend',
        sender_email: value('senderEmail'),
        sender_name: value('senderName'),
        api_key: value('secret'),
      }
    case 'feishu':
    case 'lark':
      return {
        provider: command.provider,
        app_id: value('appId'),
        app_secret: value('secret'),
        encrypt_key: optional('encryptKey'),
        verification_token: optional('verificationToken'),
      }
    case 'slack':
      return {
        provider: 'slack',
        client_id: value('clientId'),
        client_secret: value('secret'),
        signing_secret: value('signingSecret'),
        bot_token: value('botToken'),
        app_token: optional('appToken'),
      }
    case 'dingtalk':
      return {
        provider: 'ding_talk',
        corp_id: value('corpId'),
        client_id: value('clientId'),
        client_secret: value('secret'),
      }
    case 'ms_teams':
      return {
        provider: 'ms_teams',
        tenant_id: value('tenantId'),
        client_id: value('clientId'),
        client_secret: value('secret'),
      }
    case 'we_com':
      return {
        provider: 'we_com',
        corp_id: value('corpId'),
        agent_id: value('agentId'),
        secret: value('secret'),
      }
  }
}

const channelProviderErrorSchema = z.object({
  code: z.literal('bad_request'),
  message: z.string().min(1),
})

async function channelProviderErrorMessage(error: unknown): Promise<string | undefined> {
  if (!(error instanceof Response) || error.status !== 400) return undefined
  try {
    const parsed = channelProviderErrorSchema.safeParse(await error.clone().json())
    return parsed.success ? parsed.data.message : undefined
  } catch {
    return undefined
  }
}

async function channelRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (error) {
    if (error instanceof ContactImRepositoryError) throw error
    const status =
      typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
    if (status === 403)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.NoPermission)
    if (status === 409) {
      let replacementRequired = false
      if (error instanceof Response) {
        try {
          const conflict = zChannelConflictResponse.safeParse(await error.clone().json())
          replacementRequired = conflict.success && conflict.data.code === 'replacement_required'
        } catch {
          // Missing or malformed conflict details still require refreshing the saved configuration.
        }
      }
      throw new ContactImRepositoryError(
        replacementRequired
          ? ContactImRepositoryErrorCode.ReplacementRequired
          : ContactImRepositoryErrorCode.ConfigurationUpdated,
      )
    }
    throw new ContactImRepositoryError(
      ContactImRepositoryErrorCode.MutationFailed,
      await channelProviderErrorMessage(error),
    )
  }
}

/** Adapts the generated channel contract to the existing settings views. Secrets stay in commands only. */
export function createContactImApiRepository(
  organization: ContactsImPlatformOrganizationContext,
  client = consoleClient.workspace.current.humanInput.v2,
): ContactImPlatformRepository {
  const requestOptions = { context: { silent: true } }
  const guard = (organizationId: string) => {
    if (
      !organization.canManage ||
      !organization.workspaceId ||
      organizationId !== organization.organizationId
    )
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.NoPermission)
  }
  const baseView = (provider: ContactImProvider): ContactImIntegrationView => ({
    canManage: organization.canManage,
    capabilities: { directorySync: provider !== 'email' },
    channelKind: provider === 'email' ? 'email' : 'im',
    configuredValues: {},
    configuredFields: [],
    displayIdentifier: null,
    lastCheckedAt: null,
    lastSync: null,
    organizationId: organization.organizationId,
    provider,
    secretConfigured: false,
    status: 'not_configured',
    statusReason: null,
  })
  const toView = (summary: ChannelSummary): ContactImIntegrationView => ({
    ...baseView(apiProviderNames[summary.provider]),
    channelId: summary.id,
    configVersion: summary.config_version,
    callbackUrl: summary.webhook_url,
    displayIdentifier: summary.display_identifier,
    status:
      summary.status === 'connected' || summary.status === 'configured'
        ? summary.status
        : summary.status === 'invalid_credentials'
          ? 'permission_issue'
          : 'connection_error',
    statusDescription: summary.status_description,
  })
  const toDetailView = (
    detail: EmailChannelDetailResponse | ImChannelDetailResponse,
  ): ContactImIntegrationView => {
    const integration = toView(detail.summary)
    const configuredFields: ContactImProviderField[] = []
    const configuredValues: ContactImIntegrationView['configuredValues'] = {}
    const configured = (field: ContactImProviderField, present = true) => {
      if (present) configuredFields.push(field)
    }
    const plain = (field: Exclude<ContactImProviderField, 'secret'>, value: string) => {
      configuredValues[field] = value
      configured(field, Boolean(value))
    }
    if ('sender_email' in detail) {
      plain('senderEmail', detail.sender_email)
      plain('senderName', detail.sender_name)
      configured('secret', Boolean(detail.credentials.api_key))
    } else {
      const credentials = detail.credentials
      switch (credentials.provider) {
        case 'feishu':
        case 'lark':
          plain('appId', credentials.app_id)
          configured('secret', Boolean(credentials.app_secret))
          configured('verificationToken', credentials.verification_token !== null)
          configured('encryptKey', credentials.encrypt_key !== null)
          break
        case 'slack':
          plain('clientId', credentials.client_id)
          configured('secret', Boolean(credentials.client_secret))
          configured('signingSecret', Boolean(credentials.signing_secret))
          configured('botToken', Boolean(credentials.bot_token))
          configured('appToken', credentials.app_token !== null)
          break
        case 'ding_talk':
          plain('corpId', credentials.corp_id)
          plain('clientId', credentials.client_id)
          configured('secret', Boolean(credentials.client_secret))
          break
        case 'ms_teams':
          plain('tenantId', credentials.tenant_id)
          plain('clientId', credentials.client_id)
          configured('secret', Boolean(credentials.client_secret))
          break
        case 'we_com':
          plain('corpId', credentials.corp_id)
          plain('agentId', credentials.agent_id)
          configured('secret', Boolean(credentials.secret))
          break
      }
    }
    return {
      ...integration,
      configuredFields,
      configuredValues,
      secretConfigured: configuredFields.includes('secret'),
    }
  }
  const getDetail = async (summary: ChannelSummary) => {
    const input = { params: { channel_id: summary.id } }
    const detail =
      summary.kind === 'email'
        ? await client.channels.email.byChannelId.get(input, requestOptions)
        : await client.channels.im.byChannelId.get(input, requestOptions)
    return toDetailView(detail)
  }
  const getIntegrations = async (organizationId: string) => {
    guard(organizationId)
    return channelRequest(async () => {
      const { channels } = await client.channels.get(undefined, requestOptions)
      return Promise.all(channels.map(getDetail))
    })
  }
  return {
    ...createContactImSyncApi(organization.workspaceId),
    queryKey: `api:${organization.workspaceId}`,
    getIntegrations,
    async getProviderDefinitions(organizationId) {
      guard(organizationId)
      return channelRequest(async () => {
        const providers = await client.channelProviders.get(undefined, requestOptions)
        return [...providers.email_providers, ...providers.im_providers].map(
          ({ provider: apiProvider }) => {
            const provider = apiProviderNames[apiProvider]
            const metadata = providerMetadata[provider]
            return {
              authMode: 'credentials' as const,
              availability: 'available' as const,
              callbackUrl: null,
              capabilities: { directorySync: provider !== 'email' },
              channelKind: provider === 'email' ? ('email' as const) : ('im' as const),
              displayName: metadata.name,
              provider,
              requiredFields: metadata.fields,
              requiresFreshCredentials: false,
              unavailableReason: null,
            }
          },
        )
      })
    },
    async authorizeProvider() {
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.ProviderUnavailable)
    },
    async saveCredentials(command) {
      guard(command.organizationId)
      if (command.channelId && !command.expectedConfigVersion)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.ConfigurationUpdated)
      if (command.replaceActiveProvider && !command.channelId)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)
      return channelRequest(async () => {
        const params = command.channelId ? { channel_id: command.channelId } : null
        const version = command.expectedConfigVersion
        let response
        if (params && version && !command.replaceActiveProvider) {
          const credentials = updateCredentialsFor(command)
          if (credentials.provider === 'resend') {
            response = await client.channels.email.byChannelId.put(
              { params, body: { credentials, expected_config_version: version } },
              requestOptions,
            )
          } else {
            response = await client.channels.im.byChannelId.put(
              { params, body: { credentials, expected_config_version: version } },
              requestOptions,
            )
          }
        } else {
          const credentials = createCredentialsFor(command)
          if (credentials.provider === 'resend') {
            if (command.replaceActiveProvider)
              throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)
            response = await client.channels.email.post({ body: { credentials } }, requestOptions)
          } else if (params && version) {
            response = await client.channels.im.byChannelId.replacement.post(
              { params, body: { credentials, expected_config_version: version } },
              requestOptions,
            )
          } else {
            response = await client.channels.im.post({ body: { credentials } }, requestOptions)
          }
        }
        try {
          return await getDetail(response.summary)
        } catch {
          throw new ContactImRepositoryError(ContactImRepositoryErrorCode.SavedDetailsUnavailable)
        }
      })
    },
    async testConnection(command) {
      guard(command.organizationId)
      if (command.channelId && !command.expectedConfigVersion)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.ConfigurationUpdated)
      return channelRequest(async () => {
        let response
        if (command.channelId && command.expectedConfigVersion) {
          const credentials = updateCredentialsFor(command)
          const input = {
            params: { channel_id: command.channelId },
            body: { credentials, expected_config_version: command.expectedConfigVersion },
          }
          response =
            credentials.provider === 'resend'
              ? await client.channels.email.byChannelId.test.post(
                  { ...input, body: { ...input.body, credentials } },
                  requestOptions,
                )
              : await client.channels.im.byChannelId.test.post(
                  { ...input, body: { ...input.body, credentials } },
                  requestOptions,
                )
        } else {
          const credentials = createCredentialsFor(command)
          response =
            credentials.provider === 'resend'
              ? await client.channels.email.test.post({ body: { credentials } }, requestOptions)
              : await client.channels.im.test.post({ body: { credentials } }, requestOptions)
        }
        if (response.status !== 'connected')
          throw new ContactImRepositoryError(
            ContactImRepositoryErrorCode.MutationFailed,
            response.status_description,
          )
        return {
          ...baseView(command.provider),
          status: 'connected',
          statusDescription: response.status_description,
        }
      })
    },
    async disconnect(command) {
      guard(command.organizationId)
      if (!command.channelId || !command.expectedConfigVersion)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.ConfigurationUpdated)
      const input = {
        params: { channel_id: command.channelId },
        query: { expected_config_version: command.expectedConfigVersion },
      }
      await channelRequest(() =>
        command.provider === 'email'
          ? client.channels.email.byChannelId.delete(input, requestOptions)
          : client.channels.im.byChannelId.delete(input, requestOptions),
      )
      return []
    },
  }
}
