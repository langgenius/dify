import type { ContactsImPlatformOrganizationContext } from '../context'
import type { ContactImPlatformRepository } from '../repository'
import type {
  AuthorizeContactImProviderCommand,
  ContactImIntegrationView,
  ContactImOrganizationCommand,
  ContactImPage,
  ContactImProvider,
  ContactImProviderCommand,
  ContactImProviderDefinition,
  ContactImSyncItemView,
  ContactImSyncRunView,
  ListContactImSyncItemsInput,
  SaveContactImCredentialsCommand,
  TestContactImConnectionCommand,
} from '../types'
import type { ContactImMockScenario, ContactImMockScenarioSeed } from './scenarios'
import {
  ContactImAuthMode,
  ContactImConnectionStatus,
  ContactImProviderAvailability,
  ContactImProviderField,
  ContactImRepositoryError,
  ContactImRepositoryErrorCode,
  ContactImSyncStatus,
} from '../types'
import {
  countContactImSyncItems,
  createDefaultTransitionFinal,
  createEmptyContactImSyncCounts,
  getContactImMockScenarioSeed,
  ContactImMockScenario as MockScenario,
  validateContactImMockScenarioSeed,
} from './scenarios'

type LoadBarrier = {
  promise: Promise<void>
  release: () => void
}

const clone = <T>(value: T): T => structuredClone(value)

const createLoadBarrier = (): LoadBarrier => {
  let release: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })

  return { promise, release }
}

export class InMemoryContactImPlatformRepository implements ContactImPlatformRepository {
  readonly queryKey: string
  private loadBarrier: LoadBarrier | null
  private seed: ContactImMockScenarioSeed

  constructor(seed: ContactImMockScenarioSeed) {
    validateContactImMockScenarioSeed(seed)
    this.seed = clone(seed)
    this.loadBarrier = seed.pendingInitialLoad ? createLoadBarrier() : null
    this.queryKey = `mock:${seed.organization.organizationId}:${seed.scenario}:${seed.organization.canManage ? 'manager' : 'viewer'}`
  }

  private assertOrganization(organizationId: string) {
    if (organizationId !== this.seed.organization.organizationId)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)
  }

  private assertCanManage() {
    if (!this.seed.organization.canManage)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.NoPermission)
  }

  private getProvider(providerId: ContactImProviderDefinition['provider']) {
    const provider = this.seed.providers.find((item) => item.provider === providerId)

    if (!provider) throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)

    if (provider.availability !== ContactImProviderAvailability.Available)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.ProviderUnavailable)

    return provider
  }

  private getIntegration(provider: ContactImProvider) {
    return this.seed.integrations.find((integration) => integration.provider === provider)
  }

  private upsertIntegration(integration: ContactImIntegrationView) {
    const index = this.seed.integrations.findIndex(
      (current) => current.provider === integration.provider,
    )

    if (index === -1) this.seed.integrations.push(integration)
    else this.seed.integrations[index] = integration
  }

  private validateCredentials(
    provider: ContactImProviderDefinition,
    command: Pick<
      SaveContactImCredentialsCommand,
      'provider' | 'retainSecret' | 'secret' | 'values'
    >,
  ) {
    const currentIntegration = this.getIntegration(command.provider)
    const retainingCurrentSecret =
      command.retainSecret && Boolean(currentIntegration?.secretConfigured)
    const hasReplacementSecret = Boolean(command.secret?.trim())
    const missingRequiredField = provider.requiredFields.some((definition) => {
      if (!definition.required) return false
      if (definition.field === ContactImProviderField.Secret)
        return !retainingCurrentSecret && !hasReplacementSecret
      return !(
        command.values[definition.field]?.trim() ||
        currentIntegration?.configuredValues[definition.field]?.trim()
      )
    })

    if (missingRequiredField)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.RequiredFieldsMissing)

    return {
      currentIntegration,
      secretConfigured: retainingCurrentSecret || hasReplacementSecret,
    }
  }

  private async waitForInitialLoad() {
    if (this.loadBarrier) await this.loadBarrier.promise
  }

  releaseInitialLoad() {
    this.loadBarrier?.release()
    this.loadBarrier = null
  }

  toJSON() {
    return this.queryKey
  }

  async getIntegrations(organizationId: string) {
    this.assertOrganization(organizationId)
    await this.waitForInitialLoad()

    if (this.seed.failures.permissionLoad)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.PermissionLoadFailed)

    if (this.seed.failures.integrationLoad)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.IntegrationLoadFailed)

    const providerOrder = new Map(
      this.seed.providers.map((provider, index) => [provider.provider, index]),
    )
    return clone(
      [...this.seed.integrations].sort(
        (left, right) =>
          (providerOrder.get(left.provider) ?? 0) - (providerOrder.get(right.provider) ?? 0),
      ),
    )
  }

  async getProviderDefinitions(organizationId: string) {
    this.assertOrganization(organizationId)
    await this.waitForInitialLoad()

    if (this.seed.failures.providerLoad)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.ProviderLoadFailed)

    return clone(this.seed.providers)
  }

  async saveCredentials(command: SaveContactImCredentialsCommand) {
    this.assertOrganization(command.organizationId)
    this.assertCanManage()
    const provider = this.getProvider(command.provider)

    if (provider.authMode !== ContactImAuthMode.Credentials)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)

    const { currentIntegration, secretConfigured } = this.validateCredentials(provider, command)

    if (this.seed.failures.save)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.MutationFailed)

    const configuredValues: ContactImIntegrationView['configuredValues'] = {
      ...currentIntegration?.configuredValues,
      ...(Object.fromEntries(
        Object.entries(command.values)
          .map(([field, value]) => [field, value?.trim()])
          .filter((entry): entry is [string, string] => Boolean(entry[1])),
      ) as ContactImIntegrationView['configuredValues']),
    }
    const displayIdentifier =
      configuredValues.senderEmail ??
      configuredValues.appId ??
      configuredValues.clientId ??
      configuredValues.tenantId ??
      currentIntegration?.displayIdentifier ??
      null
    const integration: ContactImIntegrationView = {
      canManage: this.seed.organization.canManage,
      capabilities: clone(provider.capabilities),
      channelKind: provider.channelKind,
      configuredValues,
      displayIdentifier,
      lastCheckedAt: null,
      lastSync: currentIntegration?.lastSync ?? null,
      organizationId: this.seed.organization.organizationId,
      provider: command.provider,
      secretConfigured,
      status: ContactImConnectionStatus.Configured,
      statusReason: null,
    }
    this.upsertIntegration(integration)

    return clone(integration)
  }

  async authorizeProvider(command: AuthorizeContactImProviderCommand) {
    this.assertOrganization(command.organizationId)
    this.assertCanManage()
    const provider = this.getProvider(command.provider)

    if (provider.authMode !== ContactImAuthMode.OAuth)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)

    if (this.seed.failures.authorization)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.MutationFailed)

    const currentIntegration = this.getIntegration(command.provider)
    const integration: ContactImIntegrationView = {
      canManage: this.seed.organization.canManage,
      capabilities: clone(provider.capabilities),
      channelKind: provider.channelKind,
      configuredValues: currentIntegration?.configuredValues ?? {},
      displayIdentifier: 'oauth-workspace',
      lastCheckedAt: '2026-07-17T06:12:00.000Z',
      lastSync: currentIntegration?.lastSync ?? null,
      organizationId: this.seed.organization.organizationId,
      provider: command.provider,
      secretConfigured: false,
      status: ContactImConnectionStatus.Connected,
      statusReason: null,
    }
    this.upsertIntegration(integration)

    return clone(integration)
  }

  async testConnection(command: TestContactImConnectionCommand) {
    this.assertOrganization(command.organizationId)
    this.assertCanManage()
    const provider = this.getProvider(command.provider)

    if (provider.authMode !== ContactImAuthMode.Credentials)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)

    const { currentIntegration, secretConfigured } = this.validateCredentials(provider, command)

    if (this.seed.failures.connectionTest)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.MutationFailed)

    const configuredValues: ContactImIntegrationView['configuredValues'] = {
      ...currentIntegration?.configuredValues,
      ...command.values,
    }
    const testedIntegration: ContactImIntegrationView = {
      canManage: this.seed.organization.canManage,
      capabilities: clone(provider.capabilities),
      channelKind: provider.channelKind,
      configuredValues,
      displayIdentifier:
        configuredValues.senderEmail ?? currentIntegration?.displayIdentifier ?? null,
      lastCheckedAt: '2026-07-17T06:14:00.000Z',
      lastSync: currentIntegration?.lastSync ?? null,
      organizationId: this.seed.organization.organizationId,
      provider: provider.provider,
      secretConfigured,
      status: ContactImConnectionStatus.Connected,
      statusReason: null,
    }
    if (currentIntegration) this.upsertIntegration(testedIntegration)

    return clone(testedIntegration)
  }

  async disconnect(command: ContactImProviderCommand) {
    this.assertOrganization(command.organizationId)
    this.assertCanManage()

    if (this.seed.failures.disconnect)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.MutationFailed)

    this.seed.integrations = this.seed.integrations.filter(
      (integration) => integration.provider !== command.provider,
    )

    return this.getIntegrations(command.organizationId)
  }

  async getActiveSync(organizationId: string) {
    this.assertOrganization(organizationId)
    const activeRun = Object.values(this.seed.runs).find(
      (run) =>
        run.status === ContactImSyncStatus.Queued || run.status === ContactImSyncStatus.Running,
    )

    return activeRun ? clone(activeRun) : null
  }

  async startSync(command: ContactImOrganizationCommand) {
    this.assertOrganization(command.organizationId)
    this.assertCanManage()

    const syncIntegration = this.seed.integrations.find(
      (integration) =>
        integration.status === ContactImConnectionStatus.Connected &&
        integration.capabilities.directorySync,
    )
    if (!syncIntegration) {
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.SyncNotAllowed)
    }

    if (await this.getActiveSync(command.organizationId))
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.SyncAlreadyRunning)

    if (this.seed.failures.syncStart)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.MutationFailed)

    const id = `mock-sync-${this.seed.nextSyncNumber}`
    this.seed.nextSyncNumber += 1
    const run: ContactImSyncRunView = {
      completedAt: null,
      counts: createEmptyContactImSyncCounts(),
      durationMs: null,
      id,
      safeError: null,
      startedAt: '2026-07-17T06:20:00.000Z',
      startedBy: 'Workspace admin',
      status: ContactImSyncStatus.Queued,
    }
    this.seed.itemsByRun[id] = []
    this.seed.runs[id] = run
    this.seed.transitionFinals[id] = createDefaultTransitionFinal()

    return clone(run)
  }

  async advanceSync(runId: string) {
    const run = this.seed.runs[runId]

    if (!run) throw new ContactImRepositoryError(ContactImRepositoryErrorCode.SyncRunNotFound)

    if (run.status === ContactImSyncStatus.Queued) {
      run.status = ContactImSyncStatus.Running
      return clone(run)
    }

    if (run.status !== ContactImSyncStatus.Running) return clone(run)

    const final = this.seed.transitionFinals[runId] ?? createDefaultTransitionFinal()
    run.completedAt = '2026-07-17T06:22:04.000Z'
    run.counts = countContactImSyncItems(final.items)
    run.durationMs = 124000
    run.safeError = final.safeError
    run.status = final.status
    this.seed.itemsByRun[runId] = clone(final.items)
    const syncIntegration = this.seed.integrations.find(
      (integration) => integration.capabilities.directorySync,
    )
    if (syncIntegration) syncIntegration.lastSync = clone(run)
    delete this.seed.transitionFinals[runId]

    return clone(run)
  }

  async getSyncRun(runId: string) {
    const run = this.seed.runs[runId]

    if (!run) throw new ContactImRepositoryError(ContactImRepositoryErrorCode.SyncRunNotFound)

    if (this.seed.failures.detailRunId === runId)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.DetailLoadFailed)

    return clone(run)
  }

  async getSyncItems(
    input: ListContactImSyncItemsInput,
  ): Promise<ContactImPage<ContactImSyncItemView>> {
    const run = this.seed.runs[input.runId]

    if (!run) throw new ContactImRepositoryError(ContactImRepositoryErrorCode.SyncRunNotFound)

    if (this.seed.failures.detailRunId === input.runId)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.DetailLoadFailed)

    if (input.cursor && this.seed.failures.pageCursor === input.cursor)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.PageLoadFailed)

    const start = input.cursor ? Number.parseInt(input.cursor, 10) : 0
    if (!Number.isFinite(start) || start < 0)
      throw new ContactImRepositoryError(ContactImRepositoryErrorCode.InvalidCommand)

    const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 50)
    const filteredItems = (this.seed.itemsByRun[input.runId] ?? []).filter(
      (item) => !input.result || item.result === input.result,
    )
    const items = filteredItems.slice(start, start + pageSize)
    const nextStart = start + items.length

    return {
      items: clone(items),
      nextCursor: nextStart < filteredItems.length ? String(nextStart) : null,
    }
  }

  getDebugSnapshot() {
    return clone(this.seed)
  }
}

export const createContactImMockRepository = ({
  organization,
  scenario = MockScenario.Connected,
}: {
  organization: ContactsImPlatformOrganizationContext
  scenario?: ContactImMockScenario
}) => new InMemoryContactImPlatformRepository(getContactImMockScenarioSeed(scenario, organization))

export const createContactImMockRepositoryFromSeed = (seed: ContactImMockScenarioSeed) =>
  new InMemoryContactImPlatformRepository(seed)
