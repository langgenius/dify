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

vi.mock('@/context/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/i18n')>()),
  useDocLink: () => (path: string) => `https://docs.dify.ai/en/cloud${path}`,
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
    expect(
      screen.getByRole('heading', { name: 'contacts.imPlatform.chooseProvider', level: 3 }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'contacts.imPlatform.chooseProvider' }),
    ).not.toBeInTheDocument()
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

    expect(await screen.findAllByText(`contacts.imPlatform.status.${status}`)).not.toHaveLength(0)
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

  it('shows the sender email without including the sender name in the channel summary', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.ChannelsConfigured,
    })
    const integrations = await repository.getIntegrations(organization.organizationId)
    vi.spyOn(repository, 'getIntegrations').mockResolvedValue(
      integrations.map((integration) =>
        integration.provider === ContactImProvider.Email
          ? { ...integration, displayIdentifier: 'Acme approvals@acme.com' }
          : integration,
      ),
    )
    renderSurface({ repository })

    const channel = await screen.findByRole('group', { name: 'Email' })
    expect(
      within(channel).getByText('contacts.imPlatform.email.summary:{"email":"approvals@acme.com"}'),
    ).toBeInTheDocument()
    expect(channel).not.toHaveTextContent('Acme')
  })

  it('shows Slack connection status instead of presenting a client ID as a token', async () => {
    const repository = createContactImMockRepository({
      organization,
      scenario: ContactImMockScenario.Connected,
    })
    const integrations = await repository.getIntegrations(organization.organizationId)
    vi.spyOn(repository, 'getIntegrations').mockResolvedValue(
      integrations.map((integration) => ({
        ...integration,
        displayIdentifier: '11264416750647.11695819675697',
      })),
    )
    renderSurface({ repository })

    const channel = await screen.findByRole('group', { name: 'Slack' })
    expect(within(channel).getByText('contacts.imPlatform.status.connected')).toBeInTheDocument()
    expect(channel).not.toHaveTextContent('11264416750647.11695819675697')
  })

  it('collapses only the remaining connect options and restores them when expanded', async () => {
    const user = userEvent.setup()
    renderSurface({ scenario: ContactImMockScenario.ChannelsConfigured })

    const trigger = await screen.findByRole('button', {
      name: 'contacts.imPlatform.connectMore',
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('group', { name: 'Feishu' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'DingTalk' })).toBeVisible()

    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Feishu' })).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'DingTalk' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('group', { name: 'Email' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Slack' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'contacts.imPlatform.action.syncNow' })).toBeVisible()

    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('group', { name: 'Feishu' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'DingTalk' })).toBeVisible()
  })
})

describe('Contacts IM platform binding flows', () => {
  it('does not offer a provider placeholder callback before the channel is saved', async () => {
    const user = userEvent.setup()
    renderSurface()
    await user.click(await screen.findByRole('button', { name: /Slack.*connect/i }))

    expect(
      screen.queryByRole('button', { name: 'contacts.imPlatform.action.copyCallback' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'contacts.imPlatform.bindingDialog.openSetupGuide' }),
    ).toHaveAttribute('href', 'https://docs.slack.dev/interactivity/handling-user-interaction/')
    expect(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    ).toBeInTheDocument()
  })

  it('associates required credential errors with their fields', async () => {
    const user = userEvent.setup()
    renderSurface()
    await user.click(await screen.findByRole('button', { name: /Slack.*connect/i }))
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )

    expect(screen.getAllByText('contacts.imPlatform.bindingDialog.required')).toHaveLength(2)
    const appId = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId')
    const secret = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret')
    expect(appId).toHaveAttribute('aria-invalid', 'true')
    expect(secret).toHaveAttribute('aria-invalid', 'true')
    expect(appId).toHaveAccessibleDescription('contacts.imPlatform.bindingDialog.required')
    expect(secret).toHaveAccessibleDescription('contacts.imPlatform.bindingDialog.required')
  })

  it('opens the dialog and restores focus to the provider trigger', async () => {
    const user = userEvent.setup()
    renderSurface()
    const trigger = await screen.findByRole('button', { name: /Slack.*connect/i })
    await user.click(trigger)

    expect(screen.getByRole('dialog')).toBeVisible()
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

    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Slack' })).toHaveTextContent(
        'contacts.imPlatform.status.configured',
      )
    })
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
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )

    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Slack' })).toHaveTextContent(
        'contacts.imPlatform.status.configured',
      )
    })
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
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )

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

  it('retains credential inputs after a save failure until the dialog is closed', async () => {
    const user = userEvent.setup()
    renderSurface({ scenario: ContactImMockScenario.SaveFailure })
    await user.click(await screen.findByRole('button', { name: /Slack.*connect/i }))
    const appId = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId')
    const secret = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret')
    await user.type(appId, 'safe-app-id')
    await user.type(secret, 'retain-on-failure')
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )

    expect(
      await screen.findByText('contacts.imPlatform.bindingDialog.saveFailed'),
    ).toBeInTheDocument()
    expect(appId).toHaveValue('safe-app-id')
    expect(secret).toHaveValue('retain-on-failure')

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Slack.*connect/i }))
    expect(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret'),
    ).toHaveValue('')
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
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )

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
    const saveButton = screen.getByRole('button', {
      name: 'contacts.imPlatform.bindingDialog.saveAndContinue',
    })
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
    expect(screen.getByRole('link', { name: 'contacts.imPlatform.learnMore' })).toHaveAttribute(
      'href',
      'https://docs.dify.ai/en/cloud/use-dify/nodes/human-input',
    )
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

  it.each(['testConnection', 'saveCredentials'] as const)(
    'displays the provider error code when Email %s fails',
    async (operation) => {
      const user = userEvent.setup()
      const { repository } = renderSurface()
      const message =
        'The submitted credentials are invalid. Provider error code: restricted_api_key.'
      vi.spyOn(repository, operation).mockRejectedValue(
        new ContactImRepositoryError(ContactImRepositoryErrorCode.MutationFailed, message),
      )
      await user.click(
        within(await screen.findByRole('group', { name: 'Email' })).getByRole('button'),
      )
      await user.type(
        screen.getByLabelText('contacts.imPlatform.email.senderEmail'),
        'approvals@example.com',
      )
      await user.type(screen.getByLabelText('contacts.imPlatform.email.senderName'), 'Approvals')
      await user.type(screen.getByLabelText('contacts.imPlatform.email.apiKey'), 'resend-test-key')
      await user.click(
        screen.getByRole('button', {
          name:
            operation === 'testConnection'
              ? 'contacts.imPlatform.action.testConnection'
              : 'contacts.imPlatform.action.save',
        }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    },
  )

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
            : definition.provider === ContactImProvider.Feishu
              ? [
                  { field: ContactImProviderField.AppId, required: true },
                  { field: ContactImProviderField.Secret, required: true, secret: true },
                  {
                    field: ContactImProviderField.VerificationToken,
                    required: false,
                    secret: true,
                  },
                  { field: ContactImProviderField.EncryptKey, required: false, secret: true },
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

  it('uses the saved channel callback and reopens it without re-entering credentials', async () => {
    const user = userEvent.setup()
    const { repository, slack } = await createApiShapeRepository()
    const saved = {
      ...slack,
      channelId: 'new-slack-channel',
      configVersion: 'new-slack-version',
      callbackUrl: 'https://backend.example/callbacks/human-input/v2/im/new-slack-hook',
    }
    const getIntegrations = vi.mocked(repository.getIntegrations).mockResolvedValue([])
    const save = vi.spyOn(repository, 'saveCredentials').mockImplementation(async () => {
      getIntegrations.mockResolvedValue([saved])
      return saved
    })
    const testConnection = vi.spyOn(repository, 'testConnection')
    renderSurface({ repository })
    await user.click(await screen.findByRole('button', { name: /Slack.*connect/i }))
    expect(
      screen.queryByRole('button', { name: 'contacts.imPlatform.action.copyCallback' }),
    ).not.toBeInTheDocument()
    await fillSlackCredentials(user)
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )

    await user.click(
      await screen.findByRole('button', { name: 'contacts.imPlatform.action.copyCallback' }),
    )
    expect(copy).toHaveBeenLastCalledWith(saved.callbackUrl)
    const callback = screen.getByLabelText('contacts.imPlatform.bindingDialog.callback')
    expect(callback).toHaveValue(saved.callbackUrl)
    expect(callback).toHaveAttribute('readonly')
    expect(
      screen.queryByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret'),
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.finish' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await openConfigured(user, 'Slack')
    expect(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.finish' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret'),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }))
    expect(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret'),
    ).toHaveValue('')
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.testConnection' }),
    )
    expect(testConnection).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )
    expect(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.finish' }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.copyCallback' }),
    )
    expect(copy).toHaveBeenLastCalledWith(saved.callbackUrl)
    expect(save).toHaveBeenCalledTimes(1)
    expect(testConnection).not.toHaveBeenCalled()
  })

  it('updates the newly replaced channel when returning from callbacks to edit credentials', async () => {
    const user = userEvent.setup()
    const { repository, slack } = await createApiShapeRepository()
    const saved = {
      ...slack,
      provider: ContactImProvider.Feishu,
      channelId: 'replacement-feishu-channel',
      configVersion: 'feishu-version-1',
      displayIdentifier: 'cli_replacement',
      callbackUrl: 'https://backend.example/callbacks/human-input/v2/im/feishu-only-hook',
    }
    const getIntegrations = vi.mocked(repository.getIntegrations)
    const save = vi
      .spyOn(repository, 'saveCredentials')
      .mockImplementationOnce(async () => {
        getIntegrations.mockResolvedValue([saved])
        return saved
      })
      .mockResolvedValue({ ...saved, configVersion: 'feishu-version-2' })
    renderSurface({ repository })
    await user.click(await screen.findByRole('button', { name: /Feishu.*replace/i }))
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.replacement.confirm' }),
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId'),
      'cli_replacement',
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret'),
      'first-app-secret',
    )
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'contacts.imPlatform.action.copyCallback' }),
    )
    expect(copy).toHaveBeenLastCalledWith(saved.callbackUrl)
    expect(save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        channelId: 'slack-channel',
        expectedConfigVersion: 'version-at-open',
        provider: ContactImProvider.Feishu,
        replaceActiveProvider: true,
      }),
    )

    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }))
    expect(screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId')).toHaveValue(
      'cli_replacement',
    )
    const secret = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret')
    expect(secret).toHaveValue('')
    expect(secret).toBeRequired()
    const appId = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId')
    await user.clear(appId)
    await user.type(appId, 'cli_replacement_updated')
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )
    expect(save).toHaveBeenCalledTimes(1)
    await user.type(secret, 'updated-app-secret')
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )
    expect(
      await screen.findByRole('button', { name: 'contacts.imPlatform.bindingDialog.finish' }),
    ).toBeInTheDocument()
    expect(save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        channelId: saved.channelId,
        expectedConfigVersion: saved.configVersion,
        provider: ContactImProvider.Feishu,
        replaceActiveProvider: false,
        retainSecret: false,
        secret: 'updated-app-secret',
        values: { appId: 'cli_replacement_updated' },
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.copyCallback' }),
    )
    expect(copy).toHaveBeenLastCalledWith(saved.callbackUrl)
  })

  it('keeps a channel with no returned callback on the single-step save flow', async () => {
    const user = userEvent.setup()
    const { repository, slack } = await createApiShapeRepository()
    const saved = {
      ...slack,
      provider: ContactImProvider.DingTalk,
      channelId: 'dingtalk-channel',
      callbackUrl: null,
    }
    const save = vi.spyOn(repository, 'saveCredentials').mockResolvedValue(saved)
    renderSurface({ repository })
    await user.click(await screen.findByRole('button', { name: /DingTalk.*replace/i }))
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.replacement.confirm' }),
    )
    expect(
      screen.queryByRole('button', { name: 'contacts.imPlatform.action.copyCallback' }),
    ).not.toBeInTheDocument()
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientId'),
      'dingtalk-client',
    )
    await user.type(
      screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientSecret'),
      'dingtalk-secret',
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.connect' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(save).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('button', { name: 'contacts.imPlatform.bindingDialog.finish' }),
    ).not.toBeInTheDocument()
  })

  it('edits a saved Slack channel without a webhook using the single-step credential form', async () => {
    const user = userEvent.setup()
    const { repository, slack } = await createApiShapeRepository()
    const savedWithoutWebhook = { ...slack, callbackUrl: null }
    const integrations = await repository.getIntegrations(organization.organizationId)
    vi.mocked(repository.getIntegrations).mockResolvedValue(
      integrations.map((integration) =>
        integration.provider === ContactImProvider.Slack ? savedWithoutWebhook : integration,
      ),
    )
    const save = vi.spyOn(repository, 'saveCredentials').mockResolvedValue(savedWithoutWebhook)
    renderSurface({ repository })
    await openConfigured(user, 'Slack')

    expect(
      screen.queryByRole('button', { name: 'contacts.imPlatform.action.copyCallback' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('contacts.imPlatform.bindingDialog.callbackStep'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('contacts.imPlatform.bindingDialog.credentialsStep'),
    ).not.toBeInTheDocument()
    await fillSlackCredentials(user)
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: slack.channelId,
        expectedConfigVersion: slack.configVersion,
        replaceActiveProvider: false,
      }),
    )
  })

  it('requires fresh Slack credentials for edits, masks every secret, and sends the captured config version', async () => {
    const user = userEvent.setup()
    const { repository, slack } = await createApiShapeRepository()
    const save = vi.spyOn(repository, 'saveCredentials').mockResolvedValue(slack)
    renderSurface({ repository })
    await openConfigured(user, 'Slack')
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }))
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
    const clientId = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.clientId')
    await user.type(clientId, 'changed-client')
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )
    expect(save).not.toHaveBeenCalled()
    await user.clear(clientId)
    await fillSlackCredentials(user)
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )
    expect(
      await screen.findByRole('button', { name: 'contacts.imPlatform.bindingDialog.finish' }),
    ).toBeInTheDocument()
    expect(screen.queryByDisplayValue('test-client-secret')).not.toBeInTheDocument()
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
          'Provider error code: missing_scope. Missing permissions: users:read.email.',
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
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }))
    await fillSlackCredentials(user)
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.action.testConnection' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Provider error code: missing_scope. Missing permissions: users:read.email.',
    )
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

  it('keeps replacement inputs when the captured configuration conflicts', async () => {
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
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )
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
    expect(screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret')).toHaveValue(
      'replacement-secret',
    )
  })

  it('retries Feishu credentials after a failed save without re-entering secret fields', async () => {
    const user = userEvent.setup()
    const { repository, slack } = await createApiShapeRepository()
    const callbackUrl = 'https://backend.example/callbacks/human-input/v2/im/retried-feishu'
    const save = vi
      .spyOn(repository, 'saveCredentials')
      .mockRejectedValueOnce(
        new ContactImRepositoryError(ContactImRepositoryErrorCode.MutationFailed),
      )
      .mockResolvedValue({
        ...slack,
        provider: ContactImProvider.Feishu,
        channelId: 'retried-feishu-channel',
        configVersion: 'retried-feishu-version',
        callbackUrl,
      })
    renderSurface({ repository })
    await user.click(await screen.findByRole('button', { name: /Feishu.*replace/i }))
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.replacement.confirm' }),
    )
    const appId = screen.getByLabelText('contacts.imPlatform.bindingDialog.field.appId')
    await user.type(appId, 'incorrect-app')
    const secretInputs = [
      ['secret', 'retained-app-secret'],
      ['verificationToken', 'retained-verification-token'],
      ['encryptKey', 'retained-encrypt-key'],
    ] as const
    for (const [field, value] of secretInputs) {
      const input = screen.getByLabelText(`contacts.imPlatform.bindingDialog.field.${field}`)
      await user.type(input, value)
      expect(input).toHaveAttribute('type', 'password')
    }
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'contacts.imPlatform.bindingDialog.saveFailed',
    )
    for (const [field, value] of secretInputs)
      expect(screen.getByLabelText(`contacts.imPlatform.bindingDialog.field.${field}`)).toHaveValue(
        value,
      )

    await user.clear(appId)
    await user.type(appId, 'corrected-app')
    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.saveAndContinue' }),
    )

    expect(await screen.findByLabelText('contacts.imPlatform.bindingDialog.callback')).toHaveValue(
      callbackUrl,
    )
    expect(save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        provider: ContactImProvider.Feishu,
        retainSecret: false,
        secret: 'retained-app-secret',
        values: {
          appId: 'corrected-app',
          verificationToken: 'retained-verification-token',
          encryptKey: 'retained-encrypt-key',
        },
      }),
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.bindingDialog.back' }))
    for (const [field] of secretInputs)
      expect(screen.getByLabelText(`contacts.imPlatform.bindingDialog.field.${field}`)).toHaveValue(
        '',
      )
  })

  it('retries a failed Email save with the entered API key and clears it after saving', async () => {
    const user = userEvent.setup()
    const { repository } = await createApiShapeRepository()
    const save = vi
      .spyOn(repository, 'saveCredentials')
      .mockRejectedValueOnce(
        new ContactImRepositoryError(ContactImRepositoryErrorCode.MutationFailed),
      )
    renderSurface({ repository })
    await openConfigured(user, 'Email')
    const apiKey = screen.getByLabelText('contacts.imPlatform.email.apiKey')
    const senderName = screen.getByLabelText('contacts.imPlatform.email.senderName')
    await user.type(apiKey, 'retained-resend-key')
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'contacts.imPlatform.bindingDialog.saveFailed',
    )
    expect(apiKey).toHaveValue('retained-resend-key')
    expect(apiKey).toHaveAttribute('type', 'password')
    await user.clear(senderName)
    await user.type(senderName, 'Corrected sender')
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        provider: ContactImProvider.Email,
        retainSecret: false,
        secret: 'retained-resend-key',
        values: { senderEmail: 'approvals@acme.com', senderName: 'Corrected sender' },
      }),
    )
    await openConfigured(user, 'Email')
    expect(screen.getByLabelText('contacts.imPlatform.email.apiKey')).toHaveValue('')
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
    expect(apiKey).toHaveValue('resend-test-only')
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

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await openConfigured(user, 'Email')
    expect(screen.getByLabelText('contacts.imPlatform.email.apiKey')).toHaveValue('')
  })
})
