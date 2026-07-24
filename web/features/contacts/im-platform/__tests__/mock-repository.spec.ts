import {
  createContactImMockRepository,
  createContactImMockRepositoryFromSeed,
} from '../mock/repository'
import { ContactImMockScenario, getContactImMockScenarioSeed } from '../mock/scenarios'
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
      repository.authorizeProvider({
        organizationId: organization.organizationId,
        provider: ContactImProvider.Feishu,
        replaceActiveProvider: false,
      }),
    ).rejects.toMatchObject({ code: 'active_provider_exists' })

    await repository.authorizeProvider({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Feishu,
      replaceActiveProvider: true,
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
          status: ContactImConnectionStatus.Connected,
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

    run.counts[ContactImSyncResult.Failed] += 1

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
