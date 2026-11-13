import type {
  CredentialSlot,
  WorkflowPath,
  WorkflowReference,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { PluginCategory } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render as renderBrowser } from 'vitest-browser-react'
import deployments from '@/i18n/locales/en-US/deployments.json'
import plugin from '@/i18n/locales/en-US/plugin.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { CredentialField } from '../credential-field'

async function renderWithConsoleQueryBrowser(ui: React.ReactElement) {
  const { wrapper: Wrapper } = createConsoleQueryWrapper()
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { deployments, plugin } },
    keySeparator: false,
  })
  return renderBrowser(
    <Wrapper>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </Wrapper>,
  )
}

vi.unmock('react-i18next')

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

describe('CredentialField', () => {
  it('opens guidance when no credentials are available', async () => {
    await renderWithConsoleQueryBrowser(
      <CredentialField
        slot={{ ...credentialSlot, candidates: [] }}
        defaultValue={undefined}
        onChange={vi.fn()}
      />,
    )

    const trigger = page.getByRole('combobox', { name: 'Deepseek' })
    await expect.element(trigger).toBeEnabled()

    await trigger.click()

    const listbox = page.getByRole('listbox')
    await expect.element(listbox.getByText('No credentials yet')).toBeInTheDocument()
    await expect
      .element(listbox.getByText('Add credentials in Integrations or node settings'))
      .toBeInTheDocument()
    await expect.element(listbox.getByRole('option')).not.toBeInTheDocument()
  })

  it('shows the only source app name and opens its source preview', async () => {
    const root = workflowReference('Deployed app', 'root')
    const source = workflowReference('Order fulfillment', 'order')
    await renderWithConsoleQueryBrowser(
      <CredentialField
        slot={credentialSlot}
        paths={[workflowPath(root, source)]}
        defaultValue="credential-1"
        onChange={vi.fn()}
      />,
    )

    const sourceButton = page.getByRole('button', {
      name: 'Deepseek: From Order fulfillment',
    })
    await sourceButton.hover()

    const preview = page.getByRole('dialog', { name: 'Deepseek' })
    await expect
      .element(preview.getByRole('link', { name: /Deployed app.*Order fulfillment/ }))
      .toHaveAttribute('href', '/app/app-order/workflow')
  })

  it('shows only a count when several source apps use the credential', async () => {
    await renderWithConsoleQueryBrowser(
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
        defaultValue="credential-1"
        onChange={vi.fn()}
      />,
    )

    const sourceButton = page.getByRole('button', { name: 'Deepseek: From 2 nodes' })
    await sourceButton.click()

    const preview = page.getByRole('dialog', { name: 'Deepseek' })
    await expect.element(preview).toBeVisible()
    await expect.poll(() => preview.getByRole('link').elements().length).toBe(2)
  })
})

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})
