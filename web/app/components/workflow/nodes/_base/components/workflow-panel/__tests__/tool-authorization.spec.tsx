import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import ToolAuthorization from '../tool-authorization'

vi.mock('@/app/components/plugins/plugin-auth/hooks/use-plugin-auth', () => ({
  usePluginAuth: () => ({
    isLoading: false,
    isAuthorized: true,
    canOAuth: false,
    canApiKey: true,
    credentials: [],
  }),
}))

vi.mock('@/app/components/plugins/plugin-auth/workspace-auth', () => ({
  default: () => <div>Workspace connection picker</div>,
}))

const descriptionLabel = 'plugin.auth.appUser.connectionDescription'
const appUserTab = 'plugin.auth.appUserAuth'
const workspaceTab = 'plugin.auth.workspaceAuth'

const setup = () => {
  const store = createWorkflowStore({})
  const content = (nodeId = 'node-1', provider = 'provider-a', providerId = 'provider-id-a') => (
    <WorkflowContext value={store}>
      <ToolAuthorization
        key={nodeId}
        nodeId={nodeId}
        providerId={providerId}
        pluginPayload={{ category: 'tool', provider }}
        showAuthorizationTabs
      />
    </WorkflowContext>
  )
  return { store, content, ...render(content()) }
}

describe('Workflow tool authorization bridge', () => {
  it('preserves separate node drafts through tab changes and node panel remounts', async () => {
    const user = userEvent.setup()
    const { store, content, rerender } = setup()
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    await user.type(screen.getByRole('textbox', { name: descriptionLabel }), 'Connect first node')
    await user.click(screen.getByRole('tab', { name: workspaceTab }))
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue(
      'Connect first node',
    )

    rerender(content('node-2'))
    expect(screen.getByRole('tab', { name: workspaceTab })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue('')
    await user.type(screen.getByRole('textbox', { name: descriptionLabel }), 'Connect second node')

    rerender(content('node-1'))
    expect(screen.getByRole('tab', { name: appUserTab })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue(
      'Connect first node',
    )
    expect(store.getState().nodeAuthDrafts['node-2']?.draft?.description).toBe(
      'Connect second node',
    )
  })

  it.each([
    { provider: 'provider-b', providerId: 'provider-id-a' },
    { provider: 'provider-a', providerId: 'provider-id-b' },
  ])(
    'starts a fresh local configuration when identity changes to $provider / $providerId',
    async ({ provider, providerId }) => {
      const user = userEvent.setup()
      const { content, rerender } = setup()
      await user.click(screen.getByRole('tab', { name: appUserTab }))
      await user.type(screen.getByRole('textbox', { name: descriptionLabel }), 'Provider A only')

      rerender(content('node-1', provider, providerId))

      expect(screen.getByRole('tab', { name: workspaceTab })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await user.click(screen.getByRole('tab', { name: appUserTab }))
      expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue('')
      expect(screen.getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' })).toBeChecked()
    },
  )

  it('updates errors while editing and revalidates when returning to App user Auth', async () => {
    const user = userEvent.setup()
    const { store } = setup()
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    const description = screen.getByRole('textbox', { name: descriptionLabel })
    expect(description).toHaveAttribute('aria-invalid', 'true')
    expect(store.getState().nodeAuthDrafts['node-1']?.errors?.description).toBe(true)

    await user.type(description, 'Connect app users')
    expect(description).not.toHaveAttribute('aria-invalid', 'true')
    expect(store.getState().nodeAuthDrafts['node-1']?.errors?.description).toBe(false)
    await user.clear(description)
    expect(description).toHaveAttribute('aria-invalid', 'true')
    expect(store.getState().nodeAuthDrafts['node-1']?.errors?.description).toBe(true)

    const apiKey = screen.getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' })
    await user.click(apiKey)
    expect(apiKey).toHaveAttribute('aria-invalid', 'true')
    expect(store.getState().nodeAuthDrafts['node-1']?.errors?.methods).toBe(true)
    await user.click(apiKey)
    expect(apiKey).not.toHaveAttribute('aria-invalid', 'true')
    expect(store.getState().nodeAuthDrafts['node-1']?.errors?.methods).toBe(false)

    await user.click(screen.getByRole('tab', { name: workspaceTab }))
    expect(store.getState().nodeAuthDrafts['node-1']?.errors).toBeUndefined()
    await user.click(screen.getByRole('tab', { name: appUserTab }))
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: descriptionLabel })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })
})
