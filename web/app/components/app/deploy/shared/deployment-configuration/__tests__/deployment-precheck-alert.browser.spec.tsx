import type {
  UnsupportedNode,
  WorkflowAsToolDependency,
  WorkflowReference,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render as renderBrowser } from 'vitest-browser-react'
import deployments from '@/i18n/locales/en-US/deployments.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { DeploymentPrecheckAlert } from '../deployment-precheck-alert'

vi.unmock('react-i18next')

async function render(ui: React.ReactElement) {
  const { wrapper: Wrapper } = createConsoleQueryWrapper()
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { deployments } },
    keySeparator: false,
  })
  return renderBrowser(
    <Wrapper>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </Wrapper>,
  )
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

function workflowAsToolDependency(...paths: WorkflowReference[][]): WorkflowAsToolDependency {
  return {
    paths: paths.map((workflows) => ({ workflows })),
  }
}

function unsupportedNode(id: string, owner: Partial<UnsupportedNode> = {}): UnsupportedNode {
  return {
    id,
    title: 'Slack',
    type: 'human-input',
    ...owner,
  }
}

describe('DeploymentPrecheckAlert', () => {
  it('does not show a source for an unsupported node from the deployed app', async () => {
    await render(<DeploymentPrecheckAlert nodes={[unsupportedNode('root-node')]} />)

    await expect.element(page.getByText('Slack')).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: /From/ })).not.toBeInTheDocument()
  })

  it('shows the leaf subworkflow name and its complete dependency path', async () => {
    const root = workflowReference('Deployed app', 'root')
    const translation = workflowReference('Translation', 'translation')
    const source = workflowReference('Order fulfillment', 'order')
    await render(
      <DeploymentPrecheckAlert
        nodes={[
          unsupportedNode('child-node', {
            workflow_as_tool_dependency: workflowAsToolDependency([root, translation, source]),
          }),
        ]}
      />,
    )

    await page.getByRole('button', { name: 'Slack: From Order fulfillment' }).hover()

    const preview = page.getByRole('dialog', { name: 'Slack' })
    const sourceLink = preview.getByRole('link', {
      name: /Deployed app.*Translation.*Order fulfillment/,
    })
    await expect.element(sourceLink).toHaveAttribute('href', '/app/app-order/workflow')
    await expect.element(sourceLink).toHaveAttribute('target', '_blank')
  })

  it('includes the deployed app when matching nodes also come from workflow-as-tool paths', async () => {
    const root = workflowReference('Deployed app', 'root')
    const orderSource = workflowReference('Order fulfillment', 'order')
    const auditSource = workflowReference('Audit workflow', 'audit')
    const sharedSource = workflowReference('Shared workflow', 'shared')
    const orderPath = [root, orderSource, sharedSource]
    const auditPath = [root, auditSource, sharedSource]
    await render(
      <DeploymentPrecheckAlert
        nodes={[
          unsupportedNode('root-node'),
          unsupportedNode('order-node-1', {
            workflow_as_tool_dependency: workflowAsToolDependency(orderPath),
          }),
          unsupportedNode('order-node-2', {
            workflow_as_tool_dependency: workflowAsToolDependency(orderPath),
          }),
          unsupportedNode('audit-node', {
            workflow_as_tool_dependency: workflowAsToolDependency(auditPath),
          }),
        ]}
      />,
    )

    await expect.element(page.getByText('Slack', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Slack: From 3 nodes' }).click()

    const preview = page.getByRole('dialog', { name: 'Slack' })
    await expect.element(preview).toBeVisible()
    await expect.poll(() => preview.getByRole('link').elements().length).toBe(3)
    await expect
      .element(preview.getByRole('link', { name: 'Deployed app' }))
      .toHaveAttribute('href', '/app/app-root/workflow')
    await expect
      .element(
        preview.getByRole('link', {
          name: /Deployed app.*Order fulfillment.*Shared workflow/,
        }),
      )
      .toBeInTheDocument()
    await expect
      .element(
        preview.getByRole('link', {
          name: /Deployed app.*Audit workflow.*Shared workflow/,
        }),
      )
      .toBeInTheDocument()
  })
})

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})
