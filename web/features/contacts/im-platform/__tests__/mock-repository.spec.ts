import type {
  ChannelSummary,
  EmailProviderCredentialsWritable,
  ImProviderCredentialsInputWritable,
} from '@dify/contracts/api/console/workspace/types.gen'
import type { TestContactImConnectionCommand } from '../types'
import {
  createContactImMockRepository,
  createContactImMockRepositoryFromSeed,
} from '../mock/repository'
import { ContactImMockScenario, getContactImMockScenarioSeed } from '../mock/scenarios'
import { createContactImApiRepository } from '../repository'
import {
  ContactImConnectionStatus,
  ContactImProvider,
  ContactImRepositoryError,
  ContactImSyncResult,
  ContactImSyncStatus,
} from '../types'

const organization = {
  canManage: true,
  organizationId: 'org-test',
  workspaceId: 'workspace-test',
}

describe('Contact IM mock repository', () => {
  it('keeps every named scenario internally consistent', () => {
    for (const scenario of Object.values(ContactImMockScenario)) {
      expect(() => getContactImMockScenarioSeed(scenario, organization)).not.toThrow()
    }
  })

  it('allows Email beside one active IM binding and requires explicit IM replacement', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.Connected,
    })

    await repository.saveCredentials({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Email,
      replaceActiveProvider: false,
      retainSecret: false,
      secret: 'resend-secret',
      values: { senderEmail: 'approvals@example.com' },
    })

    await expect(
      repository.saveCredentials({
        organizationId: organization.organizationId,
        provider: ContactImProvider.Feishu,
        replaceActiveProvider: false,
        retainSecret: false,
        secret: 'feishu-test-secret',
        values: { appId: 'feishu-test-app' },
      }),
    ).rejects.toMatchObject({ code: 'active_provider_exists' })

    await repository.saveCredentials({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Feishu,
      replaceActiveProvider: true,
      retainSecret: false,
      secret: 'feishu-test-secret',
      values: { appId: 'feishu-test-app' },
    })

    const integrations = await repository.getIntegrations(organization.organizationId)
    expect(integrations.map(({ provider }) => provider)).toEqual([
      ContactImProvider.Email,
      ContactImProvider.Feishu,
    ])
    expect(integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: ContactImProvider.Email }),
        expect.objectContaining({
          provider: ContactImProvider.Feishu,
          status: ContactImConnectionStatus.Configured,
        }),
      ]),
    )
  })

  it('uses explicit advancement for deterministic sync transitions', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.Connected,
    })

    const queuedRun = await repository.startSync({
      organizationId: organization.organizationId,
    })

    expect(queuedRun).toMatchObject({
      id: 'mock-sync-1',
      status: ContactImSyncStatus.Queued,
    })
    await expect(
      repository.startSync({ organizationId: organization.organizationId }),
    ).rejects.toMatchObject({ code: 'sync_already_running' })

    const runningRun = await repository.advanceSync(queuedRun.id)
    expect(runningRun.status).toBe(ContactImSyncStatus.Running)

    const completedRun = await repository.advanceSync(queuedRun.id)
    expect(completedRun.status).toBe(ContactImSyncStatus.PartialSuccess)
    await expect(repository.getActiveSync(organization.organizationId)).resolves.toBeNull()
  })

  it('rejects a scenario whose summary counts disagree with detail items', () => {
    const seed = getContactImMockScenarioSeed(ContactImMockScenario.SyncSuccess, organization)
    const runId = Object.keys(seed.runs)[0]

    if (!runId) throw new Error('Sync success scenario must contain a run')
    const run = seed.runs[runId]
    if (!run) throw new Error('Sync success scenario run must be readable')

    run.counts[ContactImSyncResult.Failed] = (run.counts[ContactImSyncResult.Failed] ?? 0) + 1

    expect(() => createContactImMockRepositoryFromSeed(seed)).toThrow(
      'Sync summary counts do not match detail items',
    )
  })

  it('records only secret configuration state and discards submitted secret text', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.NotConfigured,
    })
    const submittedSecret = 'do-not-retain-this-secret'

    await repository.saveCredentials({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Slack,
      replaceActiveProvider: false,
      retainSecret: false,
      secret: submittedSecret,
      values: { appId: 'app-safe-id' },
    })

    const integration = (await repository.getIntegrations(organization.organizationId)).find(
      ({ provider }) => provider === ContactImProvider.Slack,
    )
    expect(integration).toMatchObject({ secretConfigured: true })
    expect(JSON.stringify(repository.getDebugSnapshot())).not.toContain(submittedSecret)
  })

  it('returns typed safe errors without leaking mutation inputs', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.SaveFailure,
    })
    const submittedSecret = 'unsafe-secret-for-failure'

    const error = await repository
      .saveCredentials({
        organizationId: organization.organizationId,
        provider: ContactImProvider.Slack,
        replaceActiveProvider: false,
        retainSecret: false,
        secret: submittedSecret,
        values: { appId: 'app-safe-id' },
      })
      .catch((caughtError: unknown) => caughtError)

    expect(error).toBeInstanceOf(ContactImRepositoryError)
    expect(JSON.stringify(error)).not.toContain(submittedSecret)
  })

  it('tracks optional secret configuration without retaining values or persisting connection tests', async () => {
    const seed = getContactImMockScenarioSeed(ContactImMockScenario.NotConfigured, organization)
    const provider = seed.providers.find((item) => item.provider === ContactImProvider.Feishu)
    if (!provider) throw new Error('The seed must offer Feishu')
    provider.requiredFields.push({ field: 'verificationToken', required: false, secret: true })
    const repository = createContactImMockRepositoryFromSeed(seed)
    const saved = await repository.saveCredentials({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Feishu,
      replaceActiveProvider: false,
      secret: 'private-app-secret',
      values: { appId: 'app-1', verificationToken: 'private-verification-token' },
    })

    expect(saved.configuredFields).toContain('verificationToken')
    expect(saved.configuredValues).toEqual({ appId: 'app-1' })
    const before = await repository.getIntegrations(organization.organizationId)
    const tested = await repository.testConnection({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Feishu,
      values: { appId: 'unsaved-app' },
      clearedFields: ['verificationToken'],
    })

    expect(tested.configuredFields).not.toContain('verificationToken')
    expect(await repository.getIntegrations(organization.organizationId)).toEqual(before)
    const cleared = await repository.saveCredentials({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Feishu,
      replaceActiveProvider: false,
      values: {},
      clearedFields: ['verificationToken'],
    })
    expect(cleared.configuredFields).not.toContain('verificationToken')
    expect(JSON.stringify(repository.getDebugSnapshot())).not.toContain('private-')
  })
})

type ChannelApiClient = NonNullable<Parameters<typeof createContactImApiRepository>[1]>
type EmailDetail = Awaited<ReturnType<ChannelApiClient['channels']['email']['byChannelId']['get']>>
type ImDetail = Awaited<ReturnType<ChannelApiClient['channels']['im']['byChannelId']['get']>>

function createChannelClient() {
  const client = {
    channelProviders: { get: vi.fn<ChannelApiClient['channelProviders']['get']>() },
    channels: {
      get: vi.fn<ChannelApiClient['channels']['get']>(),
      email: {
        post: vi.fn<ChannelApiClient['channels']['email']['post']>(),
        test: { post: vi.fn<ChannelApiClient['channels']['email']['test']['post']>() },
        byChannelId: {
          get: vi.fn<ChannelApiClient['channels']['email']['byChannelId']['get']>(),
          put: vi.fn<ChannelApiClient['channels']['email']['byChannelId']['put']>(),
          delete: vi.fn<ChannelApiClient['channels']['email']['byChannelId']['delete']>(),
          test: {
            post: vi.fn<ChannelApiClient['channels']['email']['byChannelId']['test']['post']>(),
          },
        },
      },
      im: {
        post: vi.fn<ChannelApiClient['channels']['im']['post']>(),
        test: { post: vi.fn<ChannelApiClient['channels']['im']['test']['post']>() },
        byChannelId: {
          get: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['get']>(),
          put: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['put']>(),
          delete: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['delete']>(),
          test: {
            post: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['test']['post']>(),
          },
          replacement: {
            post: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['replacement']['post']>(),
          },
        },
      },
    },
  } satisfies ChannelApiClient
  client.channels.email.byChannelId.get.mockImplementation(async ({ params }) =>
    emailDetail(channelSummary({ id: params.channel_id, kind: 'email', provider: 'resend' })),
  )
  client.channels.im.byChannelId.get.mockImplementation(async ({ params }) =>
    imDetail(channelSummary({ id: params.channel_id })),
  )
  return client
}

function channelSummary(overrides: Partial<ChannelSummary> = {}): ChannelSummary {
  return {
    id: 'channel-1',
    kind: 'im',
    provider: 'slack',
    config_version: 'snapshot-version',
    created_at: 1,
    updated_at: 2,
    status: 'connected',
    status_description: 'Connected',
    display_identifier: 'App display name',
    webhook_url: 'https://example.test/callback',
    ...overrides,
  }
}

function emailDetail(summary: ChannelSummary): EmailDetail {
  return {
    summary,
    sender_email: 'sender@example.test',
    sender_name: 'Approvals',
    credentials: { provider: 'resend', api_key: { type: 'redacted' } },
  }
}

function imDetail(summary: ChannelSummary): ImDetail {
  const redacted = { type: 'redacted' } as const
  switch (summary.provider) {
    case 'feishu':
    case 'lark':
      return {
        summary,
        credentials: {
          provider: summary.provider,
          app_id: 'app-1',
          app_secret: redacted,
          verification_token: redacted,
          encrypt_key: null,
        },
      }
    case 'slack':
      return {
        summary,
        credentials: {
          provider: 'slack',
          client_id: 'client-1',
          client_secret: redacted,
          signing_secret: redacted,
          bot_token: redacted,
          app_token: null,
        },
      }
    case 'ding_talk':
      return {
        summary,
        credentials: {
          provider: 'ding_talk',
          corp_id: 'corp-1',
          client_id: 'client-1',
          client_secret: redacted,
        },
      }
    case 'ms_teams':
      return {
        summary,
        credentials: {
          provider: 'ms_teams',
          tenant_id: 'tenant-1',
          client_id: 'client-1',
          client_secret: redacted,
        },
      }
    case 'we_com':
      return {
        summary,
        credentials: {
          provider: 'we_com',
          corp_id: 'corp-1',
          agent_id: 'agent-1',
          secret: redacted,
        },
      }
    case 'resend':
      throw new Error('Expected an IM provider')
  }
}

const slackCommand: TestContactImConnectionCommand = {
  organizationId: organization.organizationId,
  provider: ContactImProvider.Slack,
  retainSecret: false,
  secret: 'test-client-secret',
  values: {
    clientId: 'client-1',
    signingSecret: 'test-signing-secret',
    botToken: 'test-bot-token',
  },
}

const credentialCases: {
  provider: ContactImProvider
  values: TestContactImConnectionCommand['values']
  expected: EmailProviderCredentialsWritable | ImProviderCredentialsInputWritable
}[] = [
  {
    provider: ContactImProvider.Email,
    values: { senderEmail: ' sender@example.test ', senderName: ' Sender ' },
    expected: {
      provider: 'resend',
      sender_email: 'sender@example.test',
      sender_name: 'Sender',
      api_key: 'test-secret',
    },
  },
  {
    provider: ContactImProvider.Feishu,
    values: { appId: ' app-1 ', verificationToken: ' verification-1 ', encryptKey: ' ' },
    expected: {
      provider: 'feishu',
      app_id: 'app-1',
      app_secret: 'test-secret',
      verification_token: 'verification-1',
      encrypt_key: null,
    },
  },
  {
    provider: ContactImProvider.Lark,
    values: { appId: ' app-2 ' },
    expected: {
      provider: 'lark',
      app_id: 'app-2',
      app_secret: 'test-secret',
      verification_token: null,
      encrypt_key: null,
    },
  },
  {
    provider: ContactImProvider.Slack,
    values: {
      clientId: ' client-1 ',
      signingSecret: ' signing-1 ',
      botToken: ' bot-1 ',
      appToken: ' app-token-1 ',
    },
    expected: {
      provider: 'slack',
      client_id: 'client-1',
      client_secret: 'test-secret',
      signing_secret: 'signing-1',
      bot_token: 'bot-1',
      app_token: 'app-token-1',
    },
  },
  {
    provider: ContactImProvider.DingTalk,
    values: { corpId: ' corp-1 ', clientId: ' client-2 ' },
    expected: {
      provider: 'ding_talk',
      corp_id: 'corp-1',
      client_id: 'client-2',
      client_secret: 'test-secret',
    },
  },
  {
    provider: ContactImProvider.MSTeams,
    values: { tenantId: ' tenant-1 ', clientId: ' client-3 ' },
    expected: {
      provider: 'ms_teams',
      tenant_id: 'tenant-1',
      client_id: 'client-3',
      client_secret: 'test-secret',
    },
  },
  {
    provider: ContactImProvider.WeCom,
    values: { corpId: ' corp-2 ', agentId: ' agent-1 ' },
    expected: { provider: 'we_com', corp_id: 'corp-2', agent_id: 'agent-1', secret: 'test-secret' },
  },
]

describe('Contact IM channel API repository', () => {
  it('offers only server-listed providers and permits retaining saved credentials', async () => {
    const client = createChannelClient()
    client.channelProviders.get.mockResolvedValue({
      email_providers: [{ provider: 'resend', connection_mode: 'custom_app' }],
      im_providers: [
        { provider: 'slack', connection_mode: 'custom_app' },
        { provider: 'ding_talk', connection_mode: 'custom_app' },
      ],
    })
    const repository = createContactImApiRepository(organization, client)
    const definitions = await repository.getProviderDefinitions(organization.organizationId)
    expect(definitions.map((definition) => definition.provider)).toEqual([
      'email',
      'slack',
      'dingtalk',
    ])
    expect(
      definitions.every(
        (definition) =>
          definition.availability === 'available' && !definition.requiresFreshCredentials,
      ),
    ).toBe(true)
    expect(
      definitions.find((definition) => definition.provider === 'slack')?.requiredFields,
    ).toEqual(
      expect.arrayContaining([
        { field: 'signingSecret', required: true, secret: true },
        { field: 'botToken', required: true, secret: true },
      ]),
    )
    expect(
      definitions.find((definition) => definition.provider === 'dingtalk')?.requiredFields,
    ).toContainEqual({ field: 'corpId', required: true })
    client.channelProviders.get.mockResolvedValue({ email_providers: [], im_providers: [] })
    await expect(repository.getProviderDefinitions(organization.organizationId)).resolves.toEqual(
      [],
    )
  })

  it('preserves configured Email status and prefills only safe channel metadata', async () => {
    const client = createChannelClient()
    const emailSummary = channelSummary({
      id: 'email-channel',
      status: 'configured',
      kind: 'email',
      provider: 'resend',
      webhook_url: null,
    })
    client.channels.get.mockResolvedValue({ channels: [emailSummary, channelSummary()] })
    client.channels.email.byChannelId.get.mockResolvedValue({
      ...emailDetail(emailSummary),
    })
    const integrations = await createContactImApiRepository(organization, client).getIntegrations(
      organization.organizationId,
    )
    expect(client.channels.email.byChannelId.get).toHaveBeenCalledWith(
      {
        params: { channel_id: 'email-channel' },
      },
      { context: { silent: true } },
    )
    expect(integrations[0]).toMatchObject({
      provider: 'email',
      status: 'configured',
      secretConfigured: true,
      configuredValues: { senderEmail: 'sender@example.test', senderName: 'Approvals' },
      channelId: 'email-channel',
      configVersion: 'snapshot-version',
    })
    expect(integrations[1]).toMatchObject({
      configuredValues: { clientId: 'client-1' },
      configuredFields: ['clientId', 'secret', 'signingSecret', 'botToken'],
      channelId: 'channel-1',
      callbackUrl: 'https://example.test/callback',
    })
    for (const integration of integrations) {
      expect(integration).not.toHaveProperty('secret')
      expect(integration.configuredValues).not.toHaveProperty('api_key')
      expect(integration.configuredValues).not.toHaveProperty('client_secret')
    }
  })

  it.each(credentialCases)(
    'passes the complete $provider credential contract and never returns submitted secrets',
    async ({ provider, values, expected }) => {
      const client = createChannelClient()
      client.channels.email.test.post.mockResolvedValue({
        status: 'connected',
        status_description: 'Verified',
      })
      client.channels.im.test.post.mockResolvedValue({
        status: 'connected',
        status_description: 'Verified',
      })
      const result = await createContactImApiRepository(organization, client).testConnection({
        organizationId: organization.organizationId,
        provider,
        values,
        retainSecret: false,
        secret: ' test-secret ',
      })
      const endpoint =
        provider === 'email' ? client.channels.email.test.post : client.channels.im.test.post
      expect(endpoint).toHaveBeenCalledWith(
        { body: { credentials: expected } },
        { context: { silent: true } },
      )
      expect(result).toMatchObject({ provider, status: 'connected', configuredValues: {} })
      expect(JSON.stringify(result)).not.toContain('test-secret')
    },
  )

  it.each(['feishu', 'lark', 'slack', 'ding_talk', 'ms_teams', 'we_com'] as const)(
    'reads safe %s identities and converts redacted credentials into per-field state',
    async (provider) => {
      const client = createChannelClient()
      const summary = channelSummary({ provider })
      client.channels.get.mockResolvedValue({ channels: [summary] })
      client.channels.im.byChannelId.get.mockResolvedValue(imDetail(summary))

      const [integration] = await createContactImApiRepository(
        organization,
        client,
      ).getIntegrations(organization.organizationId)

      expect(integration?.configuredFields).toContain('secret')
      expect(integration?.secretConfigured).toBe(true)
      expect(JSON.stringify(integration)).not.toContain('redacted')
      expect(integration?.configuredValues).not.toHaveProperty('secret')
      expect(integration?.configuredValues).not.toHaveProperty('signingSecret')
      expect(integration?.configuredValues).not.toHaveProperty('verificationToken')
      if (provider === 'feishu' || provider === 'lark') {
        expect(integration?.configuredValues).toEqual({ appId: 'app-1' })
        expect(integration?.configuredFields).toEqual(['appId', 'secret', 'verificationToken'])
      }
      if (provider === 'slack') expect(integration?.configuredFields).not.toContain('appToken')
    },
  )

  it.each([
    {
      values: { verificationToken: ' new-verification ' },
      secret: undefined,
      changed: { verification_token: 'new-verification' },
    },
    {
      values: { encryptKey: ' new-encryption ' },
      secret: undefined,
      changed: { encrypt_key: 'new-encryption' },
    },
    { values: {}, secret: ' new-app-secret ', changed: { app_secret: 'new-app-secret' } },
    { values: { appId: ' new-app-id ' }, secret: undefined, changed: { app_id: 'new-app-id' } },
  ])(
    'updates one Feishu field while retaining all other server values: $changed',
    async ({ values, secret, changed }) => {
      const client = createChannelClient()
      const summary = channelSummary({ provider: 'feishu', config_version: 'new-version' })
      client.channels.im.byChannelId.put.mockResolvedValue({ summary })
      client.channels.im.byChannelId.get.mockResolvedValue(imDetail(summary))

      const saved = await createContactImApiRepository(organization, client).saveCredentials({
        organizationId: organization.organizationId,
        provider: ContactImProvider.Feishu,
        channelId: 'channel-1',
        expectedConfigVersion: 'snapshot-version',
        replaceActiveProvider: false,
        values,
        secret,
      })

      expect(client.channels.im.byChannelId.put).toHaveBeenCalledWith(
        {
          params: { channel_id: 'channel-1' },
          body: {
            expected_config_version: 'snapshot-version',
            credentials: {
              provider: 'feishu',
              app_id: { type: 'unchanged' },
              app_secret: { type: 'unchanged' },
              verification_token: { type: 'unchanged' },
              encrypt_key: { type: 'unchanged' },
              ...changed,
            },
          },
        },
        { context: { silent: true } },
      )
      expect(saved).toMatchObject({
        configVersion: 'new-version',
        configuredValues: { appId: 'app-1' },
        configuredFields: ['appId', 'secret', 'verificationToken'],
      })
      expect(JSON.stringify(saved)).not.toContain('new-app-secret')
    },
  )

  it.each([
    {
      values: { signingSecret: ' signing-2 ' },
      secret: undefined,
      changed: { signing_secret: 'signing-2' },
    },
    { values: { botToken: ' bot-2 ' }, secret: undefined, changed: { bot_token: 'bot-2' } },
    { values: { appToken: ' app-2 ' }, secret: undefined, changed: { app_token: 'app-2' } },
    { values: {}, secret: ' client-secret-2 ', changed: { client_secret: 'client-secret-2' } },
  ])('updates each Slack secret independently: $changed', async ({ values, secret, changed }) => {
    const client = createChannelClient()
    client.channels.im.byChannelId.put.mockResolvedValue({ summary: channelSummary() })

    await createContactImApiRepository(organization, client).saveCredentials({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Slack,
      channelId: 'channel-1',
      expectedConfigVersion: 'snapshot-version',
      replaceActiveProvider: false,
      values,
      secret,
    })

    expect(client.channels.im.byChannelId.put).toHaveBeenCalledWith(
      {
        params: { channel_id: 'channel-1' },
        body: {
          expected_config_version: 'snapshot-version',
          credentials: {
            provider: 'slack',
            client_id: { type: 'unchanged' },
            client_secret: { type: 'unchanged' },
            signing_secret: { type: 'unchanged' },
            bot_token: { type: 'unchanged' },
            app_token: { type: 'unchanged' },
            ...changed,
          },
        },
      },
      { context: { silent: true } },
    )
  })

  it('sends null only for explicitly cleared optional fields', async () => {
    const client = createChannelClient()
    const summary = channelSummary({ provider: 'feishu' })
    client.channels.im.byChannelId.put.mockResolvedValue({ summary })
    client.channels.im.byChannelId.get.mockResolvedValue(imDetail(summary))
    const repository = createContactImApiRepository(organization, client)
    const command = {
      organizationId: organization.organizationId,
      provider: ContactImProvider.Feishu,
      channelId: 'channel-1',
      expectedConfigVersion: 'snapshot-version',
      replaceActiveProvider: false,
      values: { verificationToken: '   ', encryptKey: '' },
    }

    await repository.saveCredentials(command)
    expect(client.channels.im.byChannelId.put.mock.calls[0]?.[0]?.body.credentials).toMatchObject({
      verification_token: { type: 'unchanged' },
      encrypt_key: { type: 'unchanged' },
    })
    client.channels.im.byChannelId.get.mockResolvedValue({
      summary: channelSummary({ provider: 'feishu', config_version: 'cleared-version' }),
      credentials: {
        provider: 'feishu',
        app_id: 'app-1',
        app_secret: { type: 'redacted' },
        verification_token: null,
        encrypt_key: null,
      },
    })
    const cleared = await repository.saveCredentials({
      ...command,
      clearedFields: ['verificationToken'],
    })
    expect(client.channels.im.byChannelId.put.mock.calls[1]?.[0]?.body.credentials).toMatchObject({
      verification_token: null,
      encrypt_key: { type: 'unchanged' },
      app_secret: { type: 'unchanged' },
    })
    expect(cleared.configuredFields).toEqual(['appId', 'secret'])
    expect(cleared.configVersion).toBe('cleared-version')
  })

  it('clears the optional Slack App Token while retaining every required secret', async () => {
    const client = createChannelClient()
    client.channels.im.byChannelId.put.mockResolvedValue({ summary: channelSummary() })

    await createContactImApiRepository(organization, client).saveCredentials({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Slack,
      channelId: 'channel-1',
      expectedConfigVersion: 'snapshot-version',
      replaceActiveProvider: false,
      values: {},
      clearedFields: ['appToken'],
    })

    expect(client.channels.im.byChannelId.put.mock.calls[0]?.[0]?.body.credentials).toEqual({
      provider: 'slack',
      client_id: { type: 'unchanged' },
      client_secret: { type: 'unchanged' },
      signing_secret: { type: 'unchanged' },
      bot_token: { type: 'unchanged' },
      app_token: null,
    })
  })

  it.each(['secret', 'appId', 'signingSecret'] as const)(
    'rejects an invalid explicit clear of %s before writing',
    async (field) => {
      const client = createChannelClient()
      await expect(
        createContactImApiRepository(organization, client).saveCredentials({
          organizationId: organization.organizationId,
          provider: ContactImProvider.Feishu,
          channelId: 'channel-1',
          expectedConfigVersion: 'snapshot-version',
          replaceActiveProvider: false,
          values: {},
          clearedFields: [field],
        }),
      ).rejects.toMatchObject({ code: 'invalid_command' })
      expect(client.channels.im.byChannelId.put).not.toHaveBeenCalled()
    },
  )

  it.each(['email', 'slack'] as const)(
    'tests a saved %s channel using its version and the update draft without persisting it',
    async (provider) => {
      const client = createChannelClient()
      client.channels.email.byChannelId.test.post.mockResolvedValue({
        status: 'connected',
        status_description: 'Verified',
      })
      client.channels.im.byChannelId.test.post.mockResolvedValue({
        status: 'connected',
        status_description: 'Verified',
      })
      const repository = createContactImApiRepository(organization, client)
      await repository.testConnection({
        organizationId: organization.organizationId,
        provider,
        channelId: 'channel-1',
        expectedConfigVersion: 'snapshot-version',
        values:
          provider === 'email' ? { senderName: 'Updated sender' } : { botToken: 'Updated bot' },
      })

      const endpoint =
        provider === 'email'
          ? client.channels.email.byChannelId.test.post
          : client.channels.im.byChannelId.test.post
      expect(endpoint).toHaveBeenCalledWith(
        {
          params: { channel_id: 'channel-1' },
          body: {
            expected_config_version: 'snapshot-version',
            credentials:
              provider === 'email'
                ? {
                    provider: 'resend',
                    sender_email: { type: 'unchanged' },
                    sender_name: 'Updated sender',
                    api_key: { type: 'unchanged' },
                  }
                : {
                    provider: 'slack',
                    client_id: { type: 'unchanged' },
                    client_secret: { type: 'unchanged' },
                    bot_token: 'Updated bot',
                    signing_secret: { type: 'unchanged' },
                    app_token: { type: 'unchanged' },
                  },
          },
        },
        { context: { silent: true } },
      )
      expect(client.channels.im.byChannelId.put).not.toHaveBeenCalled()
      expect(client.channels.email.byChannelId.put).not.toHaveBeenCalled()
      expect(client.channels.im.test.post).not.toHaveBeenCalled()
      expect(client.channels.email.test.post).not.toHaveBeenCalled()
    },
  )

  it('updates Email sender metadata without replacing its saved API Key', async () => {
    const client = createChannelClient()
    client.channels.email.byChannelId.put.mockResolvedValue({
      summary: channelSummary({ kind: 'email', provider: 'resend' }),
    })
    await createContactImApiRepository(organization, client).saveCredentials({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Email,
      channelId: 'channel-1',
      expectedConfigVersion: 'snapshot-version',
      replaceActiveProvider: false,
      values: { senderName: ' New sender ' },
    })
    expect(client.channels.email.byChannelId.put.mock.calls[0]?.[0]?.body.credentials).toEqual({
      provider: 'resend',
      api_key: { type: 'unchanged' },
      sender_email: { type: 'unchanged' },
      sender_name: 'New sender',
    })
  })

  it('requires a snapshot version before testing a saved channel', async () => {
    const client = createChannelClient()
    await expect(
      createContactImApiRepository(organization, client).testConnection({
        ...slackCommand,
        channelId: 'channel-1',
      }),
    ).rejects.toMatchObject({ code: 'configuration_updated' })
    expect(client.channels.im.byChannelId.test.post).not.toHaveBeenCalled()
    expect(client.channels.im.test.post).not.toHaveBeenCalled()
  })

  it.each(['email', 'slack'] as const)(
    'reports a saved %s test version conflict without leaking its draft',
    async (provider) => {
      const client = createChannelClient()
      const endpoint =
        provider === 'email'
          ? client.channels.email.byChannelId.test.post
          : client.channels.im.byChannelId.test.post
      endpoint.mockRejectedValue(
        Response.json({ message: 'unsafe-new-secret-payload' }, { status: 409 }),
      )

      const error = await createContactImApiRepository(organization, client)
        .testConnection({
          organizationId: organization.organizationId,
          provider,
          channelId: 'channel-1',
          expectedConfigVersion: 'stale-version',
          secret: 'unsafe-new-secret-payload',
          values: {},
        })
        .catch((caught: unknown) => caught)

      expect(error).toMatchObject({ code: 'configuration_updated' })
      expect(JSON.stringify(error)).not.toContain('unsafe-new-secret-payload')
    },
  )

  it('creates without a version and updates or replaces using the edited snapshot version', async () => {
    const client = createChannelClient()
    client.channels.im.post.mockResolvedValue({
      summary: channelSummary({ config_version: 'created-version' }),
    })
    client.channels.im.byChannelId.put.mockResolvedValue({
      summary: channelSummary({ config_version: 'updated-version' }),
    })
    client.channels.im.byChannelId.replacement.post.mockResolvedValue({
      summary: channelSummary({ provider: 'feishu', config_version: 'replaced-version' }),
    })
    client.channels.im.byChannelId.get
      .mockResolvedValueOnce(imDetail(channelSummary({ config_version: 'created-version' })))
      .mockResolvedValueOnce(imDetail(channelSummary({ config_version: 'updated-version' })))
      .mockResolvedValueOnce(
        imDetail(channelSummary({ provider: 'feishu', config_version: 'replaced-version' })),
      )
    const repository = createContactImApiRepository(organization, client)
    expect(
      await repository.saveCredentials({ ...slackCommand, replaceActiveProvider: false }),
    ).toMatchObject({ configVersion: 'created-version' })
    expect(client.channels.im.post.mock.calls[0]?.[0]).toEqual({
      body: {
        credentials: {
          provider: 'slack',
          client_id: 'client-1',
          client_secret: 'test-client-secret',
          signing_secret: 'test-signing-secret',
          bot_token: 'test-bot-token',
          app_token: null,
        },
      },
    })
    expect(
      await repository.saveCredentials({
        ...slackCommand,
        replaceActiveProvider: false,
        channelId: 'channel-1',
        expectedConfigVersion: 'snapshot-version',
      }),
    ).toMatchObject({ configVersion: 'updated-version' })
    expect(client.channels.im.byChannelId.put).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { channel_id: 'channel-1' },
        body: expect.objectContaining({ expected_config_version: 'snapshot-version' }),
      }),
      { context: { silent: true } },
    )
    expect(
      await repository.saveCredentials({
        organizationId: organization.organizationId,
        provider: ContactImProvider.Feishu,
        values: { appId: 'replacement-app' },
        secret: 'replacement-secret',
        retainSecret: false,
        replaceActiveProvider: true,
        channelId: 'channel-1',
        expectedConfigVersion: 'snapshot-version',
      }),
    ).toMatchObject({ provider: 'feishu', configVersion: 'replaced-version' })
    expect(client.channels.im.byChannelId.replacement.post).toHaveBeenCalledWith(
      {
        params: { channel_id: 'channel-1' },
        body: {
          expected_config_version: 'snapshot-version',
          credentials: {
            provider: 'feishu',
            app_id: 'replacement-app',
            app_secret: 'replacement-secret',
            encrypt_key: null,
            verification_token: null,
          },
        },
      },
      { context: { silent: true } },
    )
    expect(client.channels.get).not.toHaveBeenCalled()
  })

  it('routes Email create/update and both delete kinds with the caller snapshot version', async () => {
    const client = createChannelClient()
    const summary = channelSummary({ kind: 'email', provider: 'resend' })
    client.channels.email.post.mockResolvedValue({ summary })
    client.channels.email.byChannelId.put.mockResolvedValue({ summary })
    client.channels.email.byChannelId.delete.mockResolvedValue({ channel_id: 'email-id' })
    client.channels.im.byChannelId.delete.mockResolvedValue({ channel_id: 'im-id' })
    const repository = createContactImApiRepository(organization, client)
    const command = {
      organizationId: organization.organizationId,
      provider: ContactImProvider.Email,
      values: { senderEmail: 'sender@example.test', senderName: 'Sender' },
      secret: 'email-secret',
      retainSecret: false,
      replaceActiveProvider: false,
    }
    await repository.saveCredentials(command)
    await repository.saveCredentials({
      ...command,
      channelId: 'email-id',
      expectedConfigVersion: 'email-snapshot',
    })
    expect(client.channels.email.post).toHaveBeenCalledWith(
      {
        body: {
          credentials: {
            provider: 'resend',
            sender_email: 'sender@example.test',
            sender_name: 'Sender',
            api_key: 'email-secret',
          },
        },
      },
      { context: { silent: true } },
    )
    expect(client.channels.email.byChannelId.put).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { channel_id: 'email-id' },
        body: expect.objectContaining({ expected_config_version: 'email-snapshot' }),
      }),
      { context: { silent: true } },
    )
    await repository.disconnect({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Email,
      channelId: 'email-id',
      expectedConfigVersion: 'email-snapshot',
    })
    await repository.disconnect({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Slack,
      channelId: 'im-id',
      expectedConfigVersion: 'im-snapshot',
    })
    expect(client.channels.email.byChannelId.delete).toHaveBeenCalledWith(
      {
        params: { channel_id: 'email-id' },
        query: { expected_config_version: 'email-snapshot' },
      },
      { context: { silent: true } },
    )
    expect(client.channels.im.byChannelId.delete).toHaveBeenCalledWith(
      {
        params: { channel_id: 'im-id' },
        query: { expected_config_version: 'im-snapshot' },
      },
      { context: { silent: true } },
    )
  })

  it.each(['invalid_credentials', 'connection_failure'] as const)(
    'rejects HTTP-success connection tests whose provider status is %s',
    async (status) => {
      const client = createChannelClient()
      client.channels.im.test.post.mockResolvedValue({
        status,
        status_description: 'Provider verification failed',
      })
      await expect(
        createContactImApiRepository(organization, client).testConnection(slackCommand),
      ).rejects.toMatchObject({
        code: 'mutation_failed',
        statusDescription: 'Provider verification failed',
      })
    },
  )

  it.each([
    [403, 'no_permission'],
    [409, 'configuration_updated'],
  ] as const)(
    'returns a safe error for HTTP %s without retaining server or credential contents',
    async (status, code) => {
      const client = createChannelClient()
      client.channels.im.post.mockRejectedValue(
        new Response(JSON.stringify({ message: 'unsafe-provider-payload-test-client-secret' }), {
          status,
        }),
      )
      const error = await createContactImApiRepository(organization, client)
        .saveCredentials({ ...slackCommand, replaceActiveProvider: false })
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(ContactImRepositoryError)
      expect(error).toMatchObject({ code })
      expect(String(error)).not.toContain('test-client-secret')
      expect(JSON.stringify(error)).not.toContain('unsafe-provider-payload')
    },
  )

  it.each([
    { kind: 'im', operation: 'create' },
    { kind: 'im', operation: 'update' },
    { kind: 'im', operation: 'replacement' },
    { kind: 'email', operation: 'create' },
    { kind: 'email', operation: 'update' },
  ] as const)(
    'reports a persisted $kind $operation separately when only the details reload fails',
    async ({ kind, operation }) => {
      const client = createChannelClient()
      const summary = channelSummary({
        provider: kind === 'email' ? 'resend' : 'slack',
        kind,
      })
      const endpoint =
        operation === 'create'
          ? client.channels[kind].post
          : operation === 'replacement'
            ? client.channels.im.byChannelId.replacement.post
            : client.channels[kind].byChannelId.put
      endpoint.mockResolvedValue({ summary })
      client.channels[kind].byChannelId.get.mockRejectedValueOnce(
        Response.json({ message: 'unsafe-details-response' }, { status: 503 }),
      )
      client.channels.get.mockResolvedValue({ channels: [summary] })
      const repository = createContactImApiRepository(organization, client)
      const error = await repository
        .saveCredentials({
          ...slackCommand,
          provider: kind === 'email' ? ContactImProvider.Email : ContactImProvider.Slack,
          replaceActiveProvider: operation === 'replacement',
          channelId: operation === 'create' ? undefined : 'channel-1',
          expectedConfigVersion: operation === 'create' ? undefined : 'snapshot-version',
          values:
            kind === 'email'
              ? { senderEmail: 'sender@example.test', senderName: 'Sender' }
              : slackCommand.values,
        })
        .catch((caught: unknown) => caught)

      expect(error).toMatchObject({ code: 'saved_details_unavailable' })
      expect(JSON.stringify(error)).not.toContain('unsafe-details-response')
      expect(JSON.stringify(error)).not.toContain('test-client-secret')
      expect(endpoint).toHaveBeenCalledTimes(1)
      await expect(repository.getIntegrations(organization.organizationId)).resolves.toEqual([
        expect.objectContaining({ channelId: 'channel-1' }),
      ])
      expect(endpoint).toHaveBeenCalledTimes(1)
    },
  )

  it('keeps an ordinary details-read failure distinct from a completed save', async () => {
    const client = createChannelClient()
    client.channels.get.mockResolvedValue({ channels: [channelSummary()] })
    client.channels.im.byChannelId.get.mockRejectedValue(new Response(null, { status: 503 }))

    await expect(
      createContactImApiRepository(organization, client).getIntegrations(
        organization.organizationId,
      ),
    ).rejects.toMatchObject({ code: 'mutation_failed' })
    expect(client.channels.im.post).not.toHaveBeenCalled()
    expect(client.channels.im.byChannelId.put).not.toHaveBeenCalled()
  })

  it.each([
    {
      body: { code: 'replacement_required', message: 'unsafe-secret-provider-message' },
      expected: 'replacement_required',
    },
    {
      body: { code: 'provider_configuration_updated', message: 'unsafe-secret-provider-message' },
      expected: 'configuration_updated',
    },
    {
      body: { code: 'unknown_conflict', message: 'unsafe-secret-provider-message' },
      expected: 'configuration_updated',
    },
    { body: { message: 'unsafe-secret-provider-message' }, expected: 'configuration_updated' },
  ])(
    'distinguishes the validated 409 reason $body.code without retaining the raw response',
    async ({ body, expected }) => {
      const client = createChannelClient()
      client.channels.im.byChannelId.put.mockRejectedValue(Response.json(body, { status: 409 }))

      const error = await createContactImApiRepository(organization, client)
        .saveCredentials({
          ...slackCommand,
          channelId: 'channel-1',
          expectedConfigVersion: 'snapshot-version',
          replaceActiveProvider: false,
        })
        .catch((caught: unknown) => caught)

      expect(error).toMatchObject({ code: expected })
      expect(JSON.stringify(error)).not.toContain('unsafe-secret-provider-message')
      expect(client.channels.im.byChannelId.get).not.toHaveBeenCalled()
      expect(client.channels.im.byChannelId.replacement.post).not.toHaveBeenCalled()
    },
  )

  it('treats a malformed 409 response as a configuration conflict', async () => {
    const client = createChannelClient()
    client.channels.im.byChannelId.put.mockRejectedValue(new Response('not-json', { status: 409 }))

    await expect(
      createContactImApiRepository(organization, client).saveCredentials({
        ...slackCommand,
        channelId: 'channel-1',
        expectedConfigVersion: 'snapshot-version',
        replaceActiveProvider: false,
      }),
    ).rejects.toMatchObject({ code: 'configuration_updated' })
  })

  it.each(['im', 'email'] as const)(
    'preserves safe provider diagnostics when creating a %s channel',
    async (kind) => {
      const client = createChannelClient()
      const message =
        'The provider connection could not be established. Provider error code: 99991672. Missing permissions: contact:contact.base:readonly.'
      client.channels[kind].post.mockRejectedValue(
        Response.json({ code: 'bad_request', message }, { status: 400 }),
      )
      const command =
        kind === 'im'
          ? slackCommand
          : {
              ...slackCommand,
              provider: ContactImProvider.Email,
              values: { senderEmail: 'sender@example.test', senderName: 'Sender' },
            }

      await expect(
        createContactImApiRepository(organization, client).saveCredentials({
          ...command,
          replaceActiveProvider: false,
        }),
      ).rejects.toMatchObject({ code: 'mutation_failed', statusDescription: message })
    },
  )

  it('never bypasses complete create or replacement credentials through retainSecret', async () => {
    const client = createChannelClient()
    const repository = createContactImApiRepository(organization, client)
    await expect(
      repository.saveCredentials({
        ...slackCommand,
        secret: undefined,
        retainSecret: true,
        replaceActiveProvider: false,
      }),
    ).rejects.toMatchObject({ code: 'required_fields_missing' })
    await expect(
      repository.saveCredentials({
        ...slackCommand,
        secret: undefined,
        retainSecret: true,
        replaceActiveProvider: true,
        channelId: 'channel-1',
        expectedConfigVersion: 'snapshot-version',
      }),
    ).rejects.toMatchObject({ code: 'required_fields_missing' })
    await expect(
      repository.testConnection({
        ...slackCommand,
        values: { clientId: 'client-1', signingSecret: 'signing-1' },
        retainSecret: true,
      }),
    ).rejects.toMatchObject({ code: 'required_fields_missing' })
    await expect(
      repository.testConnection({
        organizationId: organization.organizationId,
        provider: ContactImProvider.DingTalk,
        secret: 'corp-secret',
        retainSecret: true,
        values: { clientId: 'client-1' },
      }),
    ).rejects.toMatchObject({ code: 'required_fields_missing' })
    expect(client.channels.im.byChannelId.put).not.toHaveBeenCalled()
    expect(client.channels.im.test.post).not.toHaveBeenCalled()
  })

  it('rejects missing version, impossible replacement, and foreign organization before issuing writes', async () => {
    const client = createChannelClient()
    const repository = createContactImApiRepository(organization, client)
    await expect(
      repository.saveCredentials({
        ...slackCommand,
        replaceActiveProvider: false,
        channelId: 'channel-1',
      }),
    ).rejects.toMatchObject({ code: 'configuration_updated' })
    await expect(
      repository.saveCredentials({ ...slackCommand, replaceActiveProvider: true }),
    ).rejects.toMatchObject({ code: 'invalid_command' })
    await expect(
      repository.disconnect({
        organizationId: organization.organizationId,
        provider: ContactImProvider.Slack,
        channelId: 'channel-1',
      }),
    ).rejects.toMatchObject({ code: 'configuration_updated' })
    await expect(
      repository.saveCredentials({
        ...slackCommand,
        organizationId: 'foreign-org',
        replaceActiveProvider: false,
      }),
    ).rejects.toMatchObject({ code: 'no_permission' })
    expect(client.channels.im.post).not.toHaveBeenCalled()
    expect(client.channels.im.byChannelId.put).not.toHaveBeenCalled()
    expect(client.channels.im.byChannelId.delete).not.toHaveBeenCalled()
  })
})
