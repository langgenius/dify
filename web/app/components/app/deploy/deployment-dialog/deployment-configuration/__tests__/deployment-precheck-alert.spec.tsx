import type {
  UnsupportedNode,
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
    name,
    workflow_id: `workflow-${suffix}`,
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
    render(
      <DeploymentPrecheckAlert
        nodes={[
          unsupportedNode('root-node', {
            from_app: workflowReference('Deployed app', 'root'),
          }),
        ]}
      />,
    )

    expect(screen.getByText('Slack')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /From/ })).not.toBeInTheDocument()
  })

  it('shows a single subworkflow name and opens its dependency preview', async () => {
    const user = userEvent.setup()
    const source = workflowReference('Order fulfillment', 'order')
    render(
      <DeploymentPrecheckAlert
        nodes={[
          unsupportedNode('child-node', {
            from_subworkflow: source,
          }),
        ]}
      />,
    )

    await user.hover(screen.getByRole('button', { name: 'Slack: From Order fulfillment' }))

    const preview = await screen.findByRole('dialog', { name: 'Slack' })
    const sourceLink = within(preview).getByRole('link', { name: 'Order fulfillment' })
    expect(sourceLink).toHaveAttribute('href', '/app/app-order/workflow')
    expect(sourceLink).toHaveAttribute('target', '_blank')
  })

  it('groups matching nodes and counts distinct subworkflow sources only', async () => {
    const user = userEvent.setup()
    const orderSource = workflowReference('Order fulfillment', 'order')
    const auditSource = workflowReference('Audit workflow', 'audit')
    render(
      <DeploymentPrecheckAlert
        nodes={[
          unsupportedNode('root-node', {
            from_app: workflowReference('Deployed app', 'root'),
          }),
          unsupportedNode('order-node-1', { from_subworkflow: orderSource }),
          unsupportedNode('order-node-2', { from_subworkflow: orderSource }),
          unsupportedNode('audit-node', { from_subworkflow: auditSource }),
        ]}
      />,
    )

    expect(screen.getAllByText('Slack')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Slack: From 2 nodes' }))

    const preview = await screen.findByRole('dialog', { name: 'Slack' })
    expect(within(preview).getAllByRole('link')).toHaveLength(2)
    expect(within(preview).getByRole('link', { name: 'Order fulfillment' })).toBeInTheDocument()
    expect(within(preview).getByRole('link', { name: 'Audit workflow' })).toBeInTheDocument()
  })
})
