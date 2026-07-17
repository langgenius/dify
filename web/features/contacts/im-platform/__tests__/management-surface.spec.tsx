import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { ContactsImPlatformProvider } from '../composition'
import { ContactsImPlatformManagementSurface } from '../management-surface'
import { createContactImMockRepository } from '../mock/repository'
import { ContactImMockScenario } from '../mock/scenarios'
import { ContactImConnectionStatus, ContactImProvider } from '../types'

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
  scenario = ContactImMockScenario.NotConfigured,
}: {
  canManage?: boolean
  scenario?: ContactImMockScenario
} = {}) => {
  const scopedOrganization = { ...organization, canManage }
  const repository = createContactImMockRepository({
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
      <ContactsImPlatformProvider organization={scopedOrganization} repository={repository}>
        {children}
      </ContactsImPlatformProvider>
    </QueryClientProvider>
  )

  return {
    queryClient,
    repository,
    ...render(<ContactsImPlatformManagementSurface />, { wrapper }),
  }
}

describe('Contacts IM platform management surface', () => {
  it('shows a dedicated loading state without treating it as not configured', () => {
    renderSurface({ scenario: ContactImMockScenario.Loading })

    expect(screen.getByRole('status', { name: 'contacts.imPlatform.loading' })).toBeInTheDocument()
    expect(screen.queryByText('contacts.imPlatform.status.not_configured')).not.toBeInTheDocument()
  })

  it('shows a load failure with a retry action', async () => {
    const user = userEvent.setup()
    const { repository } = renderSurface({ scenario: ContactImMockScenario.LoadFailure })
    const getIntegration = vi.spyOn(repository, 'getIntegration')

    expect(await screen.findByText('contacts.imPlatform.loadError.title')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.loadError.retry' }))

    expect(getIntegration).toHaveBeenCalledTimes(1)
  })

  it('does not downgrade a permission-load failure to not configured', async () => {
    renderSurface({ scenario: ContactImMockScenario.PermissionLoadFailure })

    expect(await screen.findByText('contacts.imPlatform.loadError.title')).toBeInTheDocument()
    expect(screen.queryByText('contacts.imPlatform.status.not_configured')).not.toBeInTheDocument()
  })

  it('shows all providers for the empty state', async () => {
    renderSurface()

    expect(await screen.findByText('contacts.imPlatform.status.not_configured')).toBeInTheDocument()
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
    [ContactImMockScenario.NotConfigured, ContactImConnectionStatus.NotConfigured],
    [ContactImMockScenario.Configured, ContactImConnectionStatus.Configured],
    [ContactImMockScenario.Connected, ContactImConnectionStatus.Connected],
    [ContactImMockScenario.PermissionIssue, ContactImConnectionStatus.PermissionIssue],
    [ContactImMockScenario.CallbackError, ContactImConnectionStatus.CallbackError],
    [ContactImMockScenario.ConnectionError, ContactImConnectionStatus.ConnectionError],
  ])('presents the %s connection state', async (scenario, status) => {
    renderSurface({ scenario })

    expect(await screen.findByText(`contacts.imPlatform.status.${status}`)).toBeInTheDocument()
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

  it('requires confirmation before replacing the active provider', async () => {
    const user = userEvent.setup()
    renderSurface({ scenario: ContactImMockScenario.Connected })
    await user.click(await screen.findByRole('button', { name: /Feishu.*replace/i }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'contacts.imPlatform.replacement.confirm' }),
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.action.authorize' }))

    await waitFor(async () => {
      const integration = await screen.findByText('contacts.imPlatform.status.connected')
      expect(integration).toBeInTheDocument()
    })
    expect(screen.getByText('Feishu')).toBeInTheDocument()
  })

  it('disconnects only after destructive confirmation', async () => {
    const user = userEvent.setup()
    renderSurface({ scenario: ContactImMockScenario.Connected })
    await user.click(
      await screen.findByRole('button', { name: 'contacts.imPlatform.action.disconnect' }),
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.disconnect.confirm' }))

    expect(await screen.findByText('contacts.imPlatform.status.not_configured')).toBeInTheDocument()
  })

  it('keeps the confirmation open and binding intact when disconnect fails', async () => {
    const user = userEvent.setup()
    const { repository } = renderSurface({ scenario: ContactImMockScenario.DisconnectFailure })
    await user.click(
      await screen.findByRole('button', { name: 'contacts.imPlatform.action.disconnect' }),
    )
    await user.click(screen.getByRole('button', { name: 'contacts.imPlatform.disconnect.confirm' }))

    expect(await screen.findByText('contacts.imPlatform.disconnect.failed')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await expect(repository.getIntegration(organization.organizationId)).resolves.toMatchObject({
      provider: ContactImProvider.Slack,
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
      resolveSave?.(await repository.getIntegration(organization.organizationId))
    })
  })

  it('never pre-fills an already configured secret', async () => {
    const user = userEvent.setup()
    renderSurface({ scenario: ContactImMockScenario.Configured })
    await user.click(
      await screen.findByRole('button', { name: 'contacts.imPlatform.action.configure' }),
    )

    expect(screen.getByLabelText('contacts.imPlatform.bindingDialog.field.secret')).toHaveValue('')
    expect(
      screen.getByText('contacts.imPlatform.bindingDialog.secretConfigured'),
    ).toBeInTheDocument()
  })

  it('keeps the active provider unchanged when replacement is canceled', async () => {
    const user = userEvent.setup()
    const { repository } = renderSurface({ scenario: ContactImMockScenario.Connected })
    await user.click(await screen.findByRole('button', { name: /Feishu.*replace/i }))
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await expect(repository.getIntegration(organization.organizationId)).resolves.toMatchObject({
      provider: ContactImProvider.Slack,
    })
  })
})
