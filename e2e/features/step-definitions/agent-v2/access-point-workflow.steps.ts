import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { getAgentReferencingWorkflows } from '../../agent-v2/support/agent'
import { agentBuilderPreseededResources } from '../../agent-v2/support/agent-builder-resources'
import { getAccessRegion, getPreseededResource } from './access-point-helpers'

Then(
  'I should see the Agent v2 Workflow access reference for {string}',
  async function (this: DifyWorld, workflowName: string) {
    const workflow = getPreseededResource(this, workflowName, 'workflow')
    const agent = getPreseededResource(
      this,
      agentBuilderPreseededResources.workflowReferenceAgent,
      'agent',
    )
    const references = await getAgentReferencingWorkflows(agent.id)
    const reference = references.find(item => item.app_id === workflow.id || item.app_name === workflow.name)
    if (!reference)
      throw new Error(`Agent "${agent.name}" does not reference workflow "${workflow.name}".`)

    const accessRegion = getAccessRegion(this)
    const workflowSection = accessRegion.getByRole('region', { name: 'Workflow access' })
    const row = workflowSection.getByRole('row').filter({ hasText: workflowName })
    const nodeCount = reference.node_ids?.length ?? 0

    await expect(accessRegion.getByRole('columnheader', { name: 'Name' })).toBeVisible()
    await expect(accessRegion.getByRole('columnheader', { name: 'Version' })).toBeVisible()
    await expect(accessRegion.getByRole('columnheader', { name: 'Nodes' })).toBeVisible()
    await expect(accessRegion.getByRole('columnheader', { name: 'Last updated' })).toBeVisible()
    await expect(accessRegion.getByRole('columnheader', { name: 'Actions' })).toBeVisible()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row.getByText(reference.workflow_version, { exact: true })).toBeVisible()
    await expect(row.getByText(new RegExp(`^${nodeCount} nodes?$`))).toBeVisible()
    if (reference.app_updated_at == null)
      await expect(row.getByText('N/A', { exact: true })).toBeVisible()
    else
      await expect(row.getByText('N/A', { exact: true })).not.toBeVisible()
    await expect(row.getByRole('link', { name: `Open ${workflowName} in Studio` })).toBeVisible()
  },
)

When(
  'I open the Agent v2 Workflow access reference for {string}',
  async function (this: DifyWorld, workflowName: string) {
    const workflowLink = this.getPage().getByRole('link', { name: `Open ${workflowName} in Studio` })

    const [workflowPage] = await Promise.all([
      this.getPage().waitForEvent('popup'),
      workflowLink.click(),
    ])

    this.agentBuilder.accessPoint.workflowReferencePage = workflowPage
  },
)

Then(
  'the Agent v2 Workflow access reference for {string} should open in Studio',
  async function (this: DifyWorld, workflowName: string) {
    const workflowPage = this.agentBuilder.accessPoint.workflowReferencePage
    if (!workflowPage)
      throw new Error('No Agent v2 Workflow access reference page was opened.')

    const workflow = getPreseededResource(this, workflowName, 'workflow')

    await expect(workflowPage).toHaveURL(new RegExp(`/app/${workflow.id}/workflow(?:\\?.*)?$`))
    await workflowPage.close()
    this.agentBuilder.accessPoint.workflowReferencePage = undefined
  },
)
