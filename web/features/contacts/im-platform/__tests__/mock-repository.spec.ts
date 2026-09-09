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
})

type ChannelApiClient = NonNullable<Parameters<typeof createContactImApiRepository>[1]>

function createChannelClient() {
  return {
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
        },
      },
      im: {
        post: vi.fn<ChannelApiClient['channels']['im']['post']>(),
        test: { post: vi.fn<ChannelApiClient['channels']['im']['test']['post']>() },
        byChannelId: {
          get: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['get']>(),
          put: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['put']>(),
          delete: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['delete']>(),
          replacement: {
            post: vi.fn<ChannelApiClient['channels']['im']['byChannelId']['replacement']['post']>(),
          },
        },
      },
    },
  } satisfies ChannelApiClient
}

const channelSummary = (overrides: Partial<ChannelSummary> = {}): ChannelSummary => ({
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
})

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
  it('offers only server-listed providers with fresh credential requirements', async () => {
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
          definition.availability === 'available' && definition.requiresFreshCredentials,
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
      summary: emailSummary,
      sender_email: 'sender@example.test',
      sender_name: 'Approvals',
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
      configuredValues: {},
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

  it('never bypasses required fresh secrets or identity fields through retainSecret', async () => {
    const client = createChannelClient()
    const repository = createContactImApiRepository(organization, client)
    await expect(
      repository.saveCredentials({
        ...slackCommand,
        secret: undefined,
        retainSecret: true,
        replaceActiveProvider: false,
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
