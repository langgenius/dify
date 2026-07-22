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
import { ContactImConnectionStatus, ContactImProvider } from '../types'

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
  repository,
  scenario = ContactImMockScenario.NotConfigured,
}: {
  canManage?: boolean
  repository?: ContactImPlatformRepository
  scenario?: ContactImMockScenario
} = {}) => {
  const scopedOrganization = { ...organization, canManage }
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

  it('keeps write actions disabled and explains missing permission', async () => {
    renderSurface({ canManage: false, scenario: ContactImMockScenario.NoPermission })

    expect(await screen.findByText('contacts.imPlatform.permission.title')).toBeInTheDocument()
    for (const button of screen.getAllByRole('button', { name: /connect/i }))
      expect(button).toBeDisabled()
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
    expect(screen.getByRole('group', { name: 'Feishu' })).toBeInTheDocument()
    expect(screen.getByText('contacts.imPlatform.connectMore')).toBeInTheDocument()
    expect(
      within(screen.getByRole('group', { name: 'DingTalk' })).getByRole('button'),
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
    const secret = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret')
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
    const secret = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret')
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
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret'),
      submittedSecret,
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))

    expect(await screen.findByText('contacts.imPlatform.status.configured')).toBeInTheDocument()
    expect(screen.queryByDisplayValue(submittedSecret)).not.toBeInTheDocument()
    expect(container.innerHTML).not.toContain(submittedSecret)
  })

  it('uses the mock OAuth adapter for Feishu', async () => {
    const user = userEvent.setup()
    renderSurface()
    await user.click(await screen.findByRole('button', { name: /Feishu.*connect/i }))
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.authorize' }))

    expect(await screen.findByText('contacts.imPlatform.status.connected')).toBeInTheDocument()
    expect(screen.getByText('Feishu')).toBeInTheDocument()
  })

  it('keeps the OAuth dialog recoverable after authorization fails', async () => {
    const user = userEvent.setup()
    renderSurface({ scenario: ContactImMockScenario.AuthorizationFailure })
    await user.click(await screen.findByRole('button', { name: /Feishu.*connect/i }))
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.authorize' }))

    expect(
      await screen.findByText('contacts.imPlatform.bindingDialog.authorizationFailed'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('retains safe fields but clears the secret after a save failure', async () => {
    const user = userEvent.setup()
    renderSurface({ scenario: ContactImMockScenario.SaveFailure })
    await user.click(await screen.findByRole('button', { name: /Slack.*connect/i }))
    const appId = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId')
    const secret = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret')
    await user.type(appId, 'safe-app-id')
    await user.type(secret, 'clear-on-failure')
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))

    expect(
      await screen.findByText('contacts.imPlatform.bindingDialog.saveFailed'),
    ).toBeInTheDocument()
    expect(appId).toHaveValue('safe-app-id')
    expect(secret).toHaveValue('')
  })

  it('keeps an existing provider when another channel is connected', async () => {
    const user = userEvent.setup()
    const { repository } = renderSurface({ scenario: ContactImMockScenario.Connected })
    await user.click(await screen.findByRole('button', { name: /Feishu.*connect/i }))
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.authorize' }))

    await waitFor(async () => {
      const integrations = await repository.getIntegrations(organization.organizationId)
      expect(integrations.map(({ provider }) => provider)).toEqual([
        ContactImProvider.Slack,
        ContactImProvider.Feishu,
      ])
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
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret'),
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
      within(await screen.findByRole('group', { name: 'Slack' })).getByRole('button'),
    )

    expect(screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret')).toHaveValue('')
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
    expect(screen.getByLabelText('contacts.imPlatform.email.senderName')).not.toBeRequired()
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
})

describe('Contacts IM platform manual sync', () => {
  it('enables manual sync only for a manageable connected provider with directory capability', async () => {
    renderSurface({ scenario: ContactImMockScenario.Connected })

    const syncButton = await screen.findByRole('button', {
      name: 'contacts.imPlatform.action.syncNow',
    })
    await waitFor(() => expect(syncButton).toBeEnabled())
  })

  it.each([
    [ContactImMockScenario.Configured, 'contacts.imPlatform.sync.notConnected', true],
    [ContactImMockScenario.Connected, 'contacts.imPlatform.sync.noPermission', false],
  ])('blocks sync for %s and explains why', async (scenario, reason, canManage) => {
    renderSurface({ canManage, scenario })

    expect(await screen.findByText(reason)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.syncNow' }),
    ).toBeDisabled()
  })

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
