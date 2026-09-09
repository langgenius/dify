import type {
  ChannelSummary,
  EmailProviderCredentialsWritable,
  ImProviderCredentialsInputWritable,
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
import { consoleClient } from '@/service/client'
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

const toContactImSyncRunView = (run: ImSyncRun): ContactImSyncRunView => ({
  completedAt: run.finished_at == null ? null : new Date(run.finished_at * 1000).toISOString(),
  counts: run.result_counts,
  durationMs:
    run.started_at == null || run.finished_at == null
      ? null
      : (run.finished_at - run.started_at) * 1000,
  errorMessage: run.error_message ?? null,
  id: run.id,
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
    matchedContact: contact ? { id: contact.id, name: contact.name, email: null } : null,
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

const apiProviderNames = {
  ding_talk: 'dingtalk',
  resend: 'email',
  feishu: 'feishu',
  lark: 'lark',
  ms_teams: 'ms_teams',
  slack: 'slack',
  we_com: 'we_com',
} as const

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

function credentialsFor(
  command: TestContactImConnectionCommand,
): EmailProviderCredentialsWritable | ImProviderCredentialsInputWritable {
  const required = (field: ContactImProviderField) => {
    const value = (field === 'secret' ? command.secret : command.values[field])?.trim()
    if (!value)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.RequiredFieldsMissing)
    return value
  }
  const optional = (field: Exclude<ContactImProviderField, 'secret'>) =>
    command.values[field]?.trim() || null
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

async function channelRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (error) {
    if (error instanceof ContactImRepositoryError) throw error
    const status =
      typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined
    if (status === 403)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.NoPermission)
    if (status === 409)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.ConfigurationUpdated)
    throw new ContactImRepositoryError(ContactImRepositoryErrorCode.MutationFailed)
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
    secretConfigured: true,
    status:
      summary.status === 'connected' || summary.status === 'configured'
        ? summary.status
        : summary.status === 'invalid_credentials'
          ? 'permission_issue'
          : 'connection_error',
    statusDescription: summary.status_description,
  })
  const getIntegrations = async (organizationId: string) => {
    guard(organizationId)
    return channelRequest(async () => {
      const { channels } = await client.channels.get(undefined, requestOptions)
      return Promise.all(
        channels.map(async (summary) => {
          const integration = toView(summary)
          if (summary.kind === 'email') {
            const detail = await client.channels.email.byChannelId.get(
              {
                params: { channel_id: summary.id },
              },
              requestOptions,
            )
            return {
              ...toView(detail.summary),
              configuredValues: {
                senderEmail: detail.sender_email,
                senderName: detail.sender_name,
              },
            }
          }
          return integration
        }),
      )
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
              requiresFreshCredentials: true,
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
      const credentials = credentialsFor(command)
      if (command.channelId && !command.expectedConfigVersion)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.ConfigurationUpdated)
      if (command.replaceActiveProvider && !command.channelId)
        throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)
      return channelRequest(async () => {
        const params = command.channelId ? { channel_id: command.channelId } : null
        const version = command.expectedConfigVersion
        let response
        if (credentials.provider === 'resend') {
          response =
            params && version
              ? await client.channels.email.byChannelId.put(
                  {
                    params,
                    body: { credentials, expected_config_version: version },
                  },
                  requestOptions,
                )
              : await client.channels.email.post({ body: { credentials } }, requestOptions)
        } else if (params && version) {
          const input = { params, body: { credentials, expected_config_version: version } }
          response = command.replaceActiveProvider
            ? await client.channels.im.byChannelId.replacement.post(input, requestOptions)
            : await client.channels.im.byChannelId.put(input, requestOptions)
        } else {
          response = await client.channels.im.post({ body: { credentials } }, requestOptions)
        }
        return toView(response.summary)
      })
    },
    async testConnection(command) {
      guard(command.organizationId)
      const credentials = credentialsFor(command)
      return channelRequest(async () => {
        const response =
          credentials.provider === 'resend'
            ? await client.channels.email.test.post({ body: { credentials } }, requestOptions)
            : await client.channels.im.test.post({ body: { credentials } }, requestOptions)
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
