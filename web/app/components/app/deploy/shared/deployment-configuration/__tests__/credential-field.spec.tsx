import type {
  CredentialSlot,
  WorkflowPath,
  WorkflowReference,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { PluginCategory } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { API_PREFIX } from '@/config'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { CredentialField } from '../credential-field'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'deployments.studio.precheck.from': 'From',
    'deployments.studio.precheck.nodeCount_other': '{{count}} nodes',
  })
})

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

function workflowReference(name: string, suffix: string): WorkflowReference {
  return {
    app_id: `app-${suffix}`,
    icon: '🤖',
    icon_background: '#FFEAD5',
    icon_type: 'emoji',
    name,
    workflow_id: `workflow-${suffix}`,
  }
}

function workflowPath(...workflows: WorkflowReference[]): WorkflowPath {
  return { workflows }
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

  it('shows the only source app name and opens its source preview', async () => {
    const user = userEvent.setup()
    const root = workflowReference('Deployed app', 'root')
    const source = workflowReference('Order fulfillment', 'order')
    renderWithConsoleQuery(
      <CredentialField
        slot={credentialSlot}
        paths={[workflowPath(root, source)]}
        value="credential-1"
        onChange={vi.fn()}
      />,
    )

    const sourceButton = screen.getByRole('button', {
      name: 'Deepseek: From Order fulfillment',
    })
    await user.hover(sourceButton)

    const preview = await screen.findByRole('dialog', { name: 'Deepseek' })
    expect(
      within(preview).getByRole('link', { name: /Deployed app.*Order fulfillment/ }),
    ).toHaveAttribute('href', '/app/app-order/workflow')
  })

  it('shows only a count when several source apps use the credential', async () => {
    const user = userEvent.setup()
    renderWithConsoleQuery(
      <CredentialField
        slot={credentialSlot}
        paths={[
          workflowPath(
            workflowReference('Deployed app', 'root'),
            workflowReference('Order fulfillment', 'order'),
          ),
          workflowPath(
            workflowReference('Deployed app', 'root'),
            workflowReference('Audit workflow', 'audit'),
          ),
        ]}
        value="credential-1"
        onChange={vi.fn()}
      />,
    )

    const sourceButton = screen.getByRole('button', { name: 'Deepseek: From 2 nodes' })
    expect(sourceButton).not.toHaveTextContent('Order fulfillment')
    await user.click(sourceButton)

    const preview = await screen.findByRole('dialog', { name: 'Deepseek' })
    expect(within(preview).getAllByRole('link')).toHaveLength(2)
  })
})
