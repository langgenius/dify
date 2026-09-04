import type {
  UnsupportedNode,
  WorkflowAsToolDependency,
  WorkflowReference,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeploymentPrecheckAlert } from '../deployment-precheck-alert'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'deployments.studio.precheck.description': 'It contains node types that are not yet supported:',
    'deployments.studio.precheck.from': 'From',
    'deployments.studio.precheck.nodeCount_other': '{{count}} nodes',
    'deployments.studio.precheck.supportMessage':
      'Support for these node types is coming in a future release.',
    'deployments.studio.precheck.title': "This version can't be deployed to this environment",
  })
})

vi.mock('../use-provider-icon', () => ({
  useGetProviderIcon: () => () => undefined,
}))

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
  it('does not show a source for an unsupported node from the deployed app', () => {
    render(<DeploymentPrecheckAlert nodes={[unsupportedNode('root-node')]} />)

    expect(screen.getByText('Slack')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /From/ })).not.toBeInTheDocument()
  })

  it('shows the leaf subworkflow name and its complete dependency path', async () => {
    const user = userEvent.setup()
    const root = workflowReference('Deployed app', 'root')
    const translation = workflowReference('Translation', 'translation')
    const source = workflowReference('Order fulfillment', 'order')
    render(
      <DeploymentPrecheckAlert
        nodes={[
          unsupportedNode('child-node', {
            workflow_as_tool_dependency: workflowAsToolDependency([root, translation, source]),
          }),
        ]}
      />,
    )

    await user.hover(screen.getByRole('button', { name: 'Slack: From Order fulfillment' }))

    const preview = await screen.findByRole('dialog', { name: 'Slack' })
    const sourceLink = within(preview).getByRole('link', {
      name: /Deployed app.*Translation.*Order fulfillment/,
    })
    expect(sourceLink).toHaveAttribute('href', '/app/app-order/workflow')
    expect(sourceLink).toHaveAttribute('target', '_blank')
  })

  it('includes the deployed app when matching nodes also come from workflow-as-tool paths', async () => {
    const user = userEvent.setup()
    const root = workflowReference('Deployed app', 'root')
    const orderSource = workflowReference('Order fulfillment', 'order')
    const auditSource = workflowReference('Audit workflow', 'audit')
    const sharedSource = workflowReference('Shared workflow', 'shared')
    const orderPath = [root, orderSource, sharedSource]
    const auditPath = [root, auditSource, sharedSource]
    render(
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

    expect(screen.getAllByText('Slack')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Slack: From 3 nodes' }))

    const preview = await screen.findByRole('dialog', { name: 'Slack' })
    expect(within(preview).getAllByRole('link')).toHaveLength(3)
    expect(within(preview).getByRole('link', { name: 'Deployed app' })).toHaveAttribute(
      'href',
      '/app/app-root/workflow',
    )
    expect(
      within(preview).getByRole('link', {
        name: /Deployed app.*Order fulfillment.*Shared workflow/,
      }),
    ).toBeInTheDocument()
    expect(
      within(preview).getByRole('link', {
        name: /Deployed app.*Audit workflow.*Shared workflow/,
      }),
    ).toBeInTheDocument()
  })
})
