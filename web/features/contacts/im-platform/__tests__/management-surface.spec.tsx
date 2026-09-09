import type { ReactNode } from 'react'
import type { ContactImPlatformRepository } from '../repository'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { ContactsImPlatformProvider } from '../composition'
import { ContactsImPlatformManagementSurface } from '../management-surface'
import { createContactImMockRepository } from '../mock/repository'
import { ContactImMockScenario } from '../mock/scenarios'
import {
  ContactImConnectionStatus,
  ContactImProvider,
  ContactImProviderField,
  ContactImRepositoryError,
  ContactImRepositoryErrorCode,
} from '../types'

const mockNavigation = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/contacts/settings',
  useRouter: () => ({ replace: mockNavigation.replace }),
  useSearchParams: () => mockNavigation.searchParams,
}))

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(() => true),
}))

const organization = {
  canManage: true,
  organizationId: 'org-surface',
  workspaceId: 'workspace-surface',
}

const renderSurface = ({
  canManage = true,
  workspaceId = organization.workspaceId,
  repository,
  scenario = ContactImMockScenario.NotConfigured,
}: {
  canManage?: boolean
  workspaceId?: string
  repository?: ContactImPlatformRepository
  scenario?: ContactImMockScenario
} = {}) => {
  const scopedOrganization = { ...organization, canManage, workspaceId }
  const scopedRepository =
    repository ??
    createContactImMockRepository({
      organization: scopedOrganization,
      scenario,
    })
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ContactsImPlatformProvider organization={scopedOrganization} repository={scopedRepository}>
        {children}
      </ContactsImPlatformProvider>
    </QueryClientProvider>
  )

  return {
    queryClient,
    repository: scopedRepository,
    ...render(<ContactsImPlatformManagementSurface />, { wrapper }),
  }
}

beforeEach(() => {
  mockNavigation.replace.mockReset()
  mockNavigation.searchParams = new URLSearchParams()
})

describe('Contacts IM platform management surface', () => {
  it('shows a dedicated loading state without treating it as not configured', () => {
    renderSurface({ scenario: ContactImMockScenario.Loading })

    expect(screen.getByRole('status', { name: 'contacts.imPlatform.loading' })).toBeInTheDocument()
    expect(screen.queryByText('contacts.imPlatform.status.not_configured')).not.toBeInTheDocument()
  })

  it('shows a load failure with a retry action', async () => {
    const user = userEvent.setup()
    const { repository } = renderSurface({ scenario: ContactImMockScenario.LoadFailure })
    const getIntegrations = vi.spyOn(repository, 'getIntegrations')

    expect(await screen.findByText('contacts.imPlatform.loadError.title')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.loadError.retry' }))

    expect(getIntegrations).toHaveBeenCalledTimes(1)
  })

  it('does not downgrade a permission-load failure to not configured', async () => {
    renderSurface({ scenario: ContactImMockScenario.PermissionLoadFailure })

    expect(await screen.findByText('contacts.imPlatform.loadError.title')).toBeInTheDocument()
    expect(screen.queryByText('contacts.imPlatform.status.not_configured')).not.toBeInTheDocument()
  })

  it('shows all providers for the empty state', async () => {
    renderSurface()

    expect(
      await screen.findByRole('heading', { name: 'contacts.imPlatform.title' }),
    ).toBeInTheDocument()
    expect(screen.getByText('contacts.imPlatform.chooseProvider')).toBeInTheDocument()
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('Slack')).toBeInTheDocument()
    expect(screen.getByText('Feishu')).toBeInTheDocument()
    expect(screen.getByText('DingTalk')).toBeInTheDocument()
  })

  it('shows the existing permission notice without querying restricted channel data', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.Connected,
    })
    const getIntegrations = vi.spyOn(repository, 'getIntegrations')
    const getProviderDefinitions = vi.spyOn(repository, 'getProviderDefinitions')
    const getActiveSync = vi.spyOn(repository, 'getActiveSync')
    renderSurface({ canManage: false, repository })

    expect(await screen.findByText('contacts.imPlatform.permission.title')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('contacts.imPlatform.loadError.title')).not.toBeInTheDocument()
    expect(getIntegrations).not.toHaveBeenCalled()
    expect(getProviderDefinitions).not.toHaveBeenCalled()
    expect(getActiveSync).not.toHaveBeenCalled()
  })

  it('waits for a workspace before requesting channel configuration', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.Connected,
    })
    const getIntegrations = vi.spyOn(repository, 'getIntegrations')
    const getProviderDefinitions = vi.spyOn(repository, 'getProviderDefinitions')
    renderSurface({ workspaceId: '', repository })

    expect(
      await screen.findByRole('status', { name: 'contacts.imPlatform.loading' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('contacts.imPlatform.permission.title')).not.toBeInTheDocument()
    expect(getIntegrations).not.toHaveBeenCalled()
    expect(getProviderDefinitions).not.toHaveBeenCalled()
  })

  it('disables an unavailable provider and presents its safe reason', async () => {
    renderSurface({ scenario: ContactImMockScenario.ProviderUnavailable })

    expect(
      await screen.findByText(
        'contacts.imPlatform.provider.unavailableReason.deployment_unsupported',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /DingTalk.*unavailable/i })).toBeDisabled()
  })

  it.each([
    [ContactImMockScenario.Configured, ContactImConnectionStatus.Configured],
    [ContactImMockScenario.Connected, ContactImConnectionStatus.Connected],
    [ContactImMockScenario.PermissionIssue, ContactImConnectionStatus.PermissionIssue],
    [ContactImMockScenario.CallbackError, ContactImConnectionStatus.CallbackError],
    [ContactImMockScenario.ConnectionError, ContactImConnectionStatus.ConnectionError],
  ])('presents the %s connection state', async (scenario, status) => {
    renderSurface({ scenario })

    expect(await screen.findByText(`contacts.imPlatform.status.${status}`)).toBeInTheDocument()
  })

  it('shows configured channels before the remaining connect options', async () => {
    renderSurface({ scenario: ContactImMockScenario.ChannelsConfigured })

    expect(await screen.findByText(/contacts\.imPlatform\.email\.summary/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Email' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Slack' })).toBeInTheDocument()
    expect(screen.getByText('contacts.imPlatform.connectMore')).toBeInTheDocument()
    expect(
      within(screen.getByRole('group', { name: 'Feishu' })).getByRole('button', {
        name: /Feishu.*replace/i,
      }),
    ).toBeEnabled()
  })
})

describe('Contacts IM platform binding flows', () => {
  it('copies the provider callback URL without exposing credentials', async () => {
    const user = userEvent.setup()
    renderSurface()
    await user.click(await screen.findByRole('button', { name: /Slack.*connect/i }))
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.copyCallback' }),
    )

    expect(copy).toHaveBeenCalledWith('https://example.dify.test/contacts/im/slack/callback')
  })

  it('associates required credential errors with their fields', async () => {
    const user = userEvent.setup()
    renderSurface()
    await user.click(await screen.findByRole('button', { name: /Slack.*connect/i }))
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))

    expect(screen.getAllByText('contacts.imPlatform.bindingDialog.required')).toHaveLength(2)
    const appId = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId')
    const secret = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret')
    expect(appId).toHaveAttribute('aria-invalid', 'true')
    expect(secret).toHaveAttribute('aria-invalid', 'true')
    expect(appId).toHaveAccessibleDescription('contacts.imPlatform.bindingDialog.required')
    expect(secret).toHaveAccessibleDescription('contacts.imPlatform.bindingDialog.required')
  })

  it('uses the Figma-sized dialog and restores focus to the provider trigger', async () => {
    const user = userEvent.setup()
    renderSurface()
    const trigger = await screen.findByRole('button', { name: /Slack.*connect/i })
    await user.click(trigger)

    expect(screen.getByRole('dialog')).toHaveClass('w-[520px]')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('submits a complete credential form from the keyboard', async () => {
    const user = userEvent.setup()
    renderSurface()
    await user.click(await screen.findByRole('button', { name: /Slack.*connect/i }))
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId'),
      'keyboard-app',
    )
    const secret = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret')
    await user.type(secret, 'keyboard-secret')
    secret.focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByText('contacts.imPlatform.status.configured')).toBeInTheDocument()
  })

  it('saves credentials, clears the secret, and advances to configured', async () => {
    const user = userEvent.setup()
    const { container } = renderSurface()
    const submittedSecret = 'surface-secret-must-disappear'
    await user.click(await screen.findByRole('button', { name: /Slack.*connect/i }))
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId'),
      'app-surface',
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret'),
      submittedSecret,
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))

    expect(await screen.findByText('contacts.imPlatform.status.configured')).toBeInTheDocument()
    expect(screen.queryByDisplayValue(submittedSecret)).not.toBeInTheDocument()
    expect(container.innerHTML).not.toContain(submittedSecret)
  })

  it('connects Feishu with application credentials without invoking OAuth', async () => {
    const user = userEvent.setup()
    const { repository } = renderSurface()
    const authorize = vi.spyOn(repository, 'authorizeProvider')
    const save = vi.spyOn(repository, 'saveCredentials')
    await user.click(await screen.findByRole('button', { name: /Feishu.*connect/i }))
    expect(
      screen.queryByRole('button', { name: 'contacts.imPlatform.action.authorize' }),
    ).not.toBeInTheDocument()
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId'),
      'feishu-app',
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret'),
      'feishu-test-secret',
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))

    expect(await screen.findByText('contacts.imPlatform.status.configured')).toBeInTheDocument()
    expect(authorize).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: ContactImProvider.Feishu,
        secret: 'feishu-test-secret',
        values: { appId: 'feishu-app' },
      }),
    )
  })

  it('retains safe fields but clears the secret after a save failure', async () => {
    const user = userEvent.setup()
    renderSurface({ scenario: ContactImMockScenario.SaveFailure })
    await user.click(await screen.findByRole('button', { name: /Slack.*connect/i }))
    const appId = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId')
    const secret = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret')
    await user.type(appId, 'safe-app-id')
    await user.type(secret, 'clear-on-failure')
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))

    expect(
      await screen.findByText('contacts.imPlatform.bindingDialog.saveFailed'),
    ).toBeInTheDocument()
    expect(appId).toHaveValue('safe-app-id')
    expect(secret).toHaveValue('')
  })

  it('requires confirmation before replacing the active IM binding', async () => {
    const user = userEvent.setup()
    const { repository } = renderSurface({ scenario: ContactImMockScenario.Connected })
    await user.click(await screen.findByRole('button', { name: /Feishu.*replace/i }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.replacement.confirm' }),
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId'),
      'replacement-app',
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret'),
      'replacement-test-secret',
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))

    await waitFor(async () => {
      const integrations = await repository.getIntegrations(organization.organizationId)
      expect(integrations.map(({ provider }) => provider)).toEqual([ContactImProvider.Feishu])
    })
  })

  it('prevents duplicate credential submissions while the mutation is pending', async () => {
    const user = userEvent.setup()
    const { repository } = renderSurface()
    let resolveSave:
      | ((value: Awaited<ReturnType<typeof repository.saveCredentials>>) => void)
      | null = null
    const saveCredentials = vi.spyOn(repository, 'saveCredentials').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    await user.click(await screen.findByRole('button', { name: /Slack.*connect/i }))
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId'),
      'pending-app',
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret'),
      'pending-secret',
    )
    const saveButton = screen.getByRole('button', { name: 'contacts.imPlatform.action.save' })
    await user.click(saveButton)

    expect(saveButton).toHaveAttribute('aria-disabled', 'true')
    await user.click(saveButton)
    expect(saveCredentials).toHaveBeenCalledTimes(1)

    await act(async () => {
      const resolvedRepository = createContactImMockRepository({
        organization,
        scenario: ContactImMockScenario.Configured,
      })
      const integration = (await resolvedRepository.getIntegrations(organization.organizationId))[0]
      if (!integration) throw new Error('Pending save test requires a configured integration')
      resolveSave?.(integration)
    })
  })

  it('never pre-fills an already configured secret', async () => {
    const user = userEvent.setup()
    renderSurface({ scenario: ContactImMockScenario.Configured })
    await user.click(
      within(await screen.findByRole('group', { name: 'Slack' })).getByRole('button', {
        name: /contacts\.imPlatform\.action\.configureChannel/,
      }),
    )

    expect(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret'),
    ).toHaveValue('')
    expect(
      screen.getByText('contacts.imPlatform.bindingDialog.secretConfigured'),
    ).toBeInTheDocument()
  })

  it('uses the dedicated Resend form for the Email channel', async () => {
    const user = userEvent.setup()
    renderSurface()
    const emailCard = await screen.findByRole('group', { name: 'Email' })

    await user.click(within(emailCard).getByRole('button'))

    expect(
      screen.getByRole('heading', { name: 'contacts.imPlatform.email.title' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('contacts.imPlatform.email.provider')).toHaveValue('Resend')
    expect(screen.getByLabelText('contacts.imPlatform.email.provider')).toBeDisabled()
    expect(screen.getByLabelText('contacts.imPlatform.email.senderEmail')).toBeRequired()
    expect(screen.getByLabelText('contacts.imPlatform.email.senderName')).toBeRequired()
    expect(screen.getByLabelText('contacts.imPlatform.email.apiKey')).toBeRequired()
  })

  it('tests a valid Email configuration without closing the dialog or retaining the API key', async () => {
    const user = userEvent.setup()
    const { queryClient, repository } = renderSurface()
    const testConnection = vi.spyOn(repository, 'testConnection')
    const submittedApiKey = 'resend-test-key'
    await user.click(
      within(await screen.findByRole('group', { name: 'Email' })).getByRole('button'),
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.email.senderEmail'),
      'approvals@example.com',
    )
    await user.type(screen.getByLabelText('contacts.imPlatform.email.senderName'), 'Approvals')
    await user.type(screen.getByLabelText('contacts.imPlatform.email.apiKey'), submittedApiKey)
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.testConnection' }),
    )

    expect(await screen.findByText('contacts.imPlatform.email.testSucceeded')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(testConnection).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain(submittedApiKey)
  })

  it('saves Email as a configured channel and never exposes the submitted API key', async () => {
    const user = userEvent.setup()
    const { container, repository } = renderSurface()
    const submittedApiKey = 'resend-save-key'
    await user.click(
      within(await screen.findByRole('group', { name: 'Email' })).getByRole('button'),
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.email.senderEmail'),
      'approvals@example.com',
    )
    await user.type(screen.getByLabelText('contacts.imPlatform.email.senderName'), 'Approvals')
    await user.type(screen.getByLabelText('contacts.imPlatform.email.apiKey'), submittedApiKey)
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))

    expect(await screen.findByText(/contacts\.imPlatform\.email\.summary/)).toBeInTheDocument()
    expect(screen.queryByDisplayValue(submittedApiKey)).not.toBeInTheDocument()
    expect(container.innerHTML).not.toContain(submittedApiKey)
    expect(
      JSON.stringify(await repository.getIntegrations(organization.organizationId)),
    ).not.toContain(submittedApiKey)
  })

  it('shows separate accessible Configure and Delete actions for every configured channel', async () => {
    renderSurface({ scenario: ContactImMockScenario.ChannelsConfigured })

    for (const provider of ['Email', 'Slack']) {
      const providerCard = await screen.findByRole('group', { name: provider })

      expect(
        within(providerCard).getByRole('button', {
          name: /contacts\.imPlatform\.action\.configureChannel/,
        }),
      ).toBeEnabled()
      expect(
        within(providerCard).getByRole('button', {
          name: /contacts\.imPlatform\.action\.deleteChannel/,
        }),
      ).toBeEnabled()
      expect(within(providerCard).getAllByRole('button')).toHaveLength(2)
    }
  })

  it('opens the matching configuration form from a configured channel action', async () => {
    const user = userEvent.setup()
    renderSurface({ scenario: ContactImMockScenario.ChannelsConfigured })
    const emailCard = await screen.findByRole('group', { name: 'Email' })

    await user.click(
      within(emailCard).getByRole('button', {
        name: /contacts\.imPlatform\.action\.configureChannel/,
      }),
    )

    expect(
      screen.getByRole('heading', { name: 'contacts.imPlatform.email.title' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('contacts.imPlatform.email.senderEmail')).toHaveValue(
      'approvals@acme.com',
    )
    expect(screen.getByLabelText('contacts.imPlatform.email.apiKey')).toHaveValue('')
  })

  it('cancels channel deletion without mutating and restores focus to Delete', async () => {
    const user = userEvent.setup()
    const { repository } = renderSurface({ scenario: ContactImMockScenario.ChannelsConfigured })
    const disconnect = vi.spyOn(repository, 'disconnect')
    const emailCard = await screen.findByRole('group', { name: 'Email' })
    const deleteButton = within(emailCard).getByRole('button', {
      name: /contacts\.imPlatform\.action\.deleteChannel/,
    })

    await user.click(deleteButton)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(disconnect).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(disconnect).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Email' })).toBeInTheDocument()
    await waitFor(() => expect(deleteButton).toHaveFocus())
  })

  it('deletes only the confirmed channel and returns it to the connect list', async () => {
    const user = userEvent.setup()
    const { repository } = renderSurface({ scenario: ContactImMockScenario.ChannelsConfigured })
    const slackCard = await screen.findByRole('group', { name: 'Slack' })

    await user.click(
      within(slackCard).getByRole('button', {
        name: /contacts\.imPlatform\.action\.deleteChannel/,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.delete.confirm' }))

    await waitFor(async () => {
      const integrations = await repository.getIntegrations(organization.organizationId)
      expect(integrations.some(({ provider }) => provider === ContactImProvider.Slack)).toBe(false)
    })
    expect(
      within(screen.getByRole('group', { name: 'Slack' })).getByRole('button', {
        name: /Slack.*contacts\.imPlatform\.action\.connect/,
      }),
    ).toBeEnabled()
    expect(screen.getByRole('group', { name: 'Email' })).toBeInTheDocument()
  })

  it('keeps the channel and confirmation open when deletion fails', async () => {
    const user = userEvent.setup()
    const { repository } = renderSurface({ scenario: ContactImMockScenario.DisconnectFailure })
    const slackCard = await screen.findByRole('group', { name: 'Slack' })

    await user.click(
      within(slackCard).getByRole('button', {
        name: /contacts\.imPlatform\.action\.deleteChannel/,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.delete.confirm' }))

    expect(await screen.findByText('contacts.imPlatform.delete.failed')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(
      (await repository.getIntegrations(organization.organizationId)).some(
        ({ provider }) => provider === ContactImProvider.Slack,
      ),
    ).toBe(true)
  })
})

describe('Contacts IM platform manual sync', () => {
  it('enables manual sync only for a manageable connected provider with directory capability', async () => {
    renderSurface({ scenario: ContactImMockScenario.Connected })

    const syncButton = await screen.findByRole('button', {
      name: 'contacts.imPlatform.action.syncNow',
    })
    await waitFor(() => expect(syncButton).toBeEnabled())
  })

  it.each([[ContactImMockScenario.Configured, 'contacts.imPlatform.sync.notConnected', true]])(
    'blocks sync for %s and explains why',
    async (scenario, reason, canManage) => {
      renderSurface({ canManage, scenario })

      expect(await screen.findByText(reason)).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'contacts.imPlatform.action.syncNow' }),
      ).toBeDisabled()
    },
  )

  it('blocks sync when the connected provider lacks directory capability', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.Connected,
    })
    const integrations = await repository.getIntegrations(organization.organizationId)
    vi.spyOn(repository, 'getIntegrations').mockResolvedValue(
      integrations.map((integration) => ({
        ...integration,
        capabilities: { directorySync: false },
      })),
    )
    renderSurface({ repository })

    expect(await screen.findByText('contacts.imPlatform.sync.unsupported')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.syncNow' }),
    ).toBeDisabled()
  })

  it('restores an existing active run without starting another one', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.ActiveSync,
    })
    const startSync = vi.spyOn(repository, 'startSync')
    renderSurface({ repository })

    expect(await screen.findByText('contacts.imPlatform.sync.status.queued')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.syncing' }),
    ).toBeDisabled()
    expect(startSync).not.toHaveBeenCalled()
  })

  it('prevents duplicate sync starts while the mutation is pending', async () => {
    const user = userEvent.setup()
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.Connected,
    })
    let resolveStart: ((value: Awaited<ReturnType<typeof repository.startSync>>) => void) | null =
      null
    const startSyncImplementation = repository.startSync.bind(repository)
    const startSync = vi.spyOn(repository, 'startSync').mockImplementation(async (command) => {
      const run = await startSyncImplementation(command)
      return new Promise((resolve) => {
        resolveStart = resolve
        void run
      })
    })
    renderSurface({ repository })
    const syncButton = await screen.findByRole('button', {
      name: 'contacts.imPlatform.action.syncNow',
    })

    await user.click(syncButton)
    expect(syncButton).toHaveAttribute('aria-disabled', 'true')
    await user.click(syncButton)
    expect(startSync).toHaveBeenCalledTimes(1)

    await act(async () => resolveStart?.(await repository.getSyncRun('mock-sync-1')))
  })

  it('keeps sync retryable after a start failure', async () => {
    const user = userEvent.setup()
    renderSurface({ scenario: ContactImMockScenario.SyncStartFailure })
    const syncButton = await screen.findByRole('button', {
      name: 'contacts.imPlatform.action.syncNow',
    })
    await waitFor(() => expect(syncButton).toBeEnabled())
    await user.click(syncButton)

    expect(await screen.findByText('contacts.imPlatform.sync.startFailed')).toBeInTheDocument()
    await waitFor(() => expect(syncButton).toBeEnabled())
  })

  it.each([
    [ContactImMockScenario.SyncSuccess, 'contacts.imPlatform.sync.status.success'],
    [ContactImMockScenario.SyncPartialSuccess, 'contacts.imPlatform.sync.status.partial_success'],
    [ContactImMockScenario.SyncFailure, 'contacts.imPlatform.sync.status.failure'],
  ])('presents the latest %s summary', async (scenario, statusLabel) => {
    renderSurface({ scenario })

    expect(await screen.findByText(statusLabel)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.viewDetails' }),
    ).toBeEnabled()
  })

  it('restores sync details from sync_run_id and removes it when closed', async () => {
    const user = userEvent.setup()
    mockNavigation.searchParams = new URLSearchParams({
      sync_run_id: 'mock-sync-success',
    })
    renderSurface({ scenario: ContactImMockScenario.SyncSuccess })

    expect(
      await screen.findByRole('heading', { name: 'contacts.imPlatform.details.title' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(mockNavigation.replace).toHaveBeenCalledWith('/contacts/settings', { scroll: false })
  })

  it('restores focus to the details trigger after closing the overlay', async () => {
    const user = userEvent.setup()
    renderSurface({ scenario: ContactImMockScenario.SyncSuccess })
    const trigger = await screen.findByRole('button', {
      name: 'contacts.imPlatform.action.viewDetails',
    })
    await user.click(trigger)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

describe('Contacts channel credential API contracts', () => {
  const createApiShapeRepository = async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.ChannelsConfigured,
    })
    const definitions = await repository.getProviderDefinitions(organization.organizationId)
    vi.spyOn(repository, 'getProviderDefinitions').mockResolvedValue(
      definitions.map((definition) => ({
        ...definition,
        requiresFreshCredentials: true,
        callbackUrl: null,
        requiredFields:
          definition.provider === ContactImProvider.Slack
            ? [
                { field: ContactImProviderField.ClientId, required: true },
                { field: ContactImProviderField.Secret, required: true, secret: true },
                { field: ContactImProviderField.SigningSecret, required: true, secret: true },
                { field: ContactImProviderField.BotToken, required: true, secret: true },
                { field: ContactImProviderField.AppToken, required: false, secret: true },
              ]
            : definition.requiredFields,
      })),
    )
    const integrations = (await repository.getIntegrations(organization.organizationId)).map(
      (integration) => ({
        ...integration,
        channelId: `${integration.provider}-channel`,
        configVersion: 'version-at-open',
        callbackUrl:
          integration.provider === ContactImProvider.Slack
            ? 'https://example.dify.test/actual-webhook'
            : null,
        configuredValues:
          integration.provider === ContactImProvider.Email ? integration.configuredValues : {},
      }),
    )
    vi.spyOn(repository, 'getIntegrations').mockResolvedValue(integrations)
    const slack = integrations.find(
      (integration) => integration.provider === ContactImProvider.Slack,
    )
    if (!slack) throw new Error('Configured Slack fixture is required')
    return { repository, slack }
  }

  const fillSlackCredentials = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientId'),
      'slack-client',
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret'),
      'test-client-secret',
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.signingSecret'),
      'test-signing-secret',
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.botToken'),
      'xoxb-test-only',
    )
  }

  const openConfigured = async (user: ReturnType<typeof userEvent.setup>, provider: string) => {
    await user.click(
      within(await screen.findByRole('group', { name: provider })).getByRole('button', {
        name: /contacts\.imPlatform\.action\.configureChannel/,
      }),
    )
  }

  it('requires fresh Slack credentials for edits, masks every secret, and sends the captured config version', async () => {
    const user = userEvent.setup()
    const { repository, slack } = await createApiShapeRepository()
    const save = vi.spyOn(repository, 'saveCredentials').mockResolvedValue(slack)
    renderSurface({ repository })
    await openConfigured(user, 'Slack')
    expect(
      screen.getByText('contacts.imPlatform.bindingDialog.freshCredentials'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('contacts.imPlatform.bindingDialog.secretConfigured'),
    ).not.toBeInTheDocument()
    for (const field of ['clientSecret', 'signingSecret', 'botToken', 'appToken'])
      expect(
        screen.getByLabelText(`contacts.imPlatform.bindingDialog.field.${field}`),
      ).toHaveAttribute('type', 'password')
    expect(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appToken'),
    ).not.toBeRequired()
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))
    expect(save).not.toHaveBeenCalled()
    await fillSlackCredentials(user)
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(save).toHaveBeenCalledWith({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Slack,
      channelId: 'slack-channel',
      expectedConfigVersion: 'version-at-open',
      replaceActiveProvider: false,
      retainSecret: false,
      secret: 'test-client-secret',
      values: {
        clientId: 'slack-client',
        signingSecret: 'test-signing-secret',
        botToken: 'xoxb-test-only',
      },
    })
  })

  it('uses the server webhook and never reports a failed connection test as success', async () => {
    const user = userEvent.setup()
    const { repository, slack } = await createApiShapeRepository()
    const testConnection = vi
      .spyOn(repository, 'testConnection')
      .mockRejectedValueOnce(
        new ContactImRepositoryError(
          ContactImRepositoryErrorCode.MutationFailed,
          'The provider rejected these credentials.',
        ),
      )
      .mockResolvedValue(slack)
    const save = vi.spyOn(repository, 'saveCredentials')
    renderSurface({ repository })
    await openConfigured(user, 'Slack')
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.copyCallback' }),
    )
    expect(copy).toHaveBeenCalledWith('https://example.dify.test/actual-webhook')
    await fillSlackCredentials(user)
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.testConnection' }),
    )
    expect(await screen.findByText('The provider rejected these credentials.')).toBeInTheDocument()
    expect(screen.queryByText('contacts.imPlatform.email.testSucceeded')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.testConnection' }),
    )
    expect(await screen.findByText('contacts.imPlatform.email.testSucceeded')).toBeInTheDocument()
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appToken'),
      'xapp-test-only',
    )
    expect(screen.queryByText('contacts.imPlatform.email.testSucceeded')).not.toBeInTheDocument()
    expect(testConnection).toHaveBeenCalledTimes(2)
  })

  it('keeps replacement open when the captured configuration conflicts and clears secret fields', async () => {
    const user = userEvent.setup()
    const { repository } = await createApiShapeRepository()
    const save = vi
      .spyOn(repository, 'saveCredentials')
      .mockRejectedValue(
        new ContactImRepositoryError(ContactImRepositoryErrorCode.ConfigurationUpdated),
      )
    renderSurface({ repository })
    await user.click(await screen.findByRole('button', { name: /Feishu.*replace/i }))
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.replacement.confirm' }),
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId'),
      'replacement-app',
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret'),
      'replacement-secret',
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))
    expect(await screen.findByText('contacts.imPlatform.configurationUpdated')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: ContactImProvider.Feishu,
        replaceActiveProvider: true,
        channelId: 'slack-channel',
        expectedConfigVersion: 'version-at-open',
        retainSecret: false,
      }),
    )
    expect(screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId')).toHaveValue(
      'replacement-app',
    )
    expect(screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret')).toHaveValue('')
  })

  it('passes the delete version and keeps confirmation open when the channel changed', async () => {
    const user = userEvent.setup()
    const { repository } = await createApiShapeRepository()
    const disconnect = vi
      .spyOn(repository, 'disconnect')
      .mockRejectedValue(
        new ContactImRepositoryError(ContactImRepositoryErrorCode.ConfigurationUpdated),
      )
    renderSurface({ repository })
    await user.click(
      within(await screen.findByRole('group', { name: 'Slack' })).getByRole('button', {
        name: /contacts\.imPlatform\.action\.deleteChannel/,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.delete.confirm' }))
    expect(await screen.findByText('contacts.imPlatform.configurationUpdated')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(disconnect).toHaveBeenCalledWith({
      organizationId: organization.organizationId,
      provider: ContactImProvider.Slack,
      channelId: 'slack-channel',
      expectedConfigVersion: 'version-at-open',
    })
  })

  it('requires a fresh Resend key for edits and keeps sender details after a failed test', async () => {
    const user = userEvent.setup()
    const { repository } = await createApiShapeRepository()
    const testConnection = vi
      .spyOn(repository, 'testConnection')
      .mockRejectedValue(new ContactImRepositoryError(ContactImRepositoryErrorCode.MutationFailed))
    renderSurface({ repository })
    await openConfigured(user, 'Email')
    const apiKey = screen.getByLabelText('contacts.imPlatform.email.apiKey')
    expect(apiKey).toBeRequired()
    expect(apiKey).toHaveValue('')
    expect(screen.getByLabelText('contacts.imPlatform.email.senderName')).toBeRequired()
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.testConnection' }),
    )
    expect(testConnection).not.toHaveBeenCalled()
    await user.type(apiKey, 'resend-test-only')
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.testConnection' }),
    )
    expect(
      await screen.findByText('contacts.imPlatform.bindingDialog.testFailed'),
    ).toBeInTheDocument()
    expect(screen.queryByText('contacts.imPlatform.email.testSucceeded')).not.toBeInTheDocument()
    expect(screen.getByLabelText('contacts.imPlatform.email.senderEmail')).toHaveValue(
      'approvals@acme.com',
    )
    expect(testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        retainSecret: false,
        secret: 'resend-test-only',
        values: { senderEmail: 'approvals@acme.com', senderName: 'Acme' },
      }),
    )
  })
})
