import type { CredentialSlot } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { PluginCategory } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { API_PREFIX } from '@/config'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { CredentialField } from '../credential-field'

const themeState = vi.hoisted(() => ({
  theme: 'light',
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: themeState.theme }),
}))

const credentialSlot: CredentialSlot = {
  candidates: [
    {
      category: PluginCategory.PLUGIN_CATEGORY_MODEL,
      credential_id: 'credential-1',
      display_name: 'Deployment key',
      from_enterprise: true,
      provider_id: 'langgenius/deepseek',
    },
  ],
  category: PluginCategory.PLUGIN_CATEGORY_MODEL,
  icon: 'deepseek-light.svg',
  icon_dark: 'deepseek-dark.svg',
  provider_id: 'langgenius/deepseek',
}

function renderCredentialField() {
  return renderWithConsoleQuery(
    <CredentialField slot={credentialSlot} value="credential-1" onChange={vi.fn()} />,
  )
}

function getDecorativeIcon(container: HTMLElement) {
  const icon = container.querySelector('img')
  if (!icon) throw new Error('Expected the credential provider icon.')

  return icon
}

describe('CredentialField', () => {
  beforeEach(() => {
    themeState.theme = 'light'
  })

  it('resolves the light credential provider icon through the current workspace', () => {
    const { container } = renderCredentialField()

    expect(getDecorativeIcon(container)).toHaveAttribute(
      'src',
      `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=workspace-1&filename=deepseek-light.svg`,
    )
  })

  it('resolves the dark credential provider icon in dark mode', () => {
    themeState.theme = 'dark'
    const { container } = renderCredentialField()

    expect(getDecorativeIcon(container)).toHaveAttribute(
      'src',
      `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=workspace-1&filename=deepseek-dark.svg`,
    )
  })

  it('opens guidance when no credentials are available', async () => {
    const user = userEvent.setup()
    renderWithConsoleQuery(
      <CredentialField
        slot={{ ...credentialSlot, candidates: [] }}
        value={undefined}
        onChange={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Deepseek' })
    expect(trigger).toBeEnabled()

    await user.click(trigger)

    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText('deployments.studio.noCredentialsYet')).toBeInTheDocument()
    expect(
      within(listbox).getByText('deployments.studio.noCredentialsYetDescription'),
    ).toBeInTheDocument()
    expect(within(listbox).queryByRole('option')).not.toBeInTheDocument()
  })
})
