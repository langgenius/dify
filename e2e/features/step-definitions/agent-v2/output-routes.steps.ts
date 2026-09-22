import type { DifyWorld } from '../../support/world.ts'
import { Given, Then, When } from '@cucumber/cucumber'
import { zWorkflowOutputRoutes } from '@dify/contracts/api/console/apps/zod.gen'
import { expect } from '@playwright/test'
import * as z from 'zod'
import { createTestApp } from '../../../support/api/apps.ts'
import { createE2EResourceName } from '../../../support/naming.ts'
import {
  createConfiguredTestAgent,
  publishAgentWithPublishableDraft,
} from '../../agent-v2/support/agent.ts'
import {
  createRoutedAgentNode,
  createRoutedAgentWorkflowDraft,
} from '../../agent-v2/support/output-routes.ts'
import { getAgentV2WorkflowNodeData } from '../../agent-v2/support/workflow.ts'

const zSnippetInsertionGraph = z.object({
  nodes: z.array(z.object({ id: z.string(), data: z.object({ title: z.string() }) })),
  edges: z.array(z.object({ source: z.string(), target: z.string() })),
})

Given(
  'a workflow with two Agent v2 output routes and a failure branch has been created via API',
  async function (this: DifyWorld) {
    const client = this.getConsoleClient()
    const agent = await createConfiguredTestAgent(client)
    this.createdAgentIds.push(agent.id)
    await publishAgentWithPublishableDraft(client, agent.id)

    const app = await createTestApp(
      client,
      createE2EResourceName('App', 'agent-output-routes'),
      'workflow',
    )
    this.createdAppIds.push(app.id)
    this.lastCreatedAppName = app.name
    await client.apps.byAppId.workflows.draft.post({
      body: createRoutedAgentWorkflowDraft(agent.id),
      params: { app_id: app.id },
    })
  },
)

Given(
  'a published snippet ending in an Agent v2 with output routes has been created via API',
  async function (this: DifyWorld) {
    const client = this.getConsoleClient()
    const agent = await createConfiguredTestAgent(client)
    this.createdAgentIds.push(agent.id)
    await publishAgentWithPublishableDraft(client, agent.id)

    const name = createE2EResourceName('Snippet', 'agent-output-routes')
    const imported = await client.workspaces.current.customizedSnippets.imports.post({
      body: {
        mode: 'yaml-content',
        yaml_content: JSON.stringify({
          version: '0.2.0',
          kind: 'snippet',
          snippet: { name, description: '', type: 'node' },
          workflow: {
            graph: {
              nodes: [createRoutedAgentNode(agent.id)],
              edges: [],
              viewport: { x: 0, y: 0, zoom: 1 },
            },
          },
        }),
      },
    })
    if (!imported.snippet_id) throw new Error(`Snippet fixture import failed: ${imported.error}`)
    this.createdSnippetIds.push(imported.snippet_id)
    expect(imported.status).toBe('completed')
    this.agentBuilder.workflow.outputRouteSnippet = { id: imported.snippet_id, name }
    await client.snippets.bySnippetId.workflows.publish.post({
      body: {},
      params: { snippet_id: imported.snippet_id },
    })
  },
)

When('I drag the Rejected Agent output route above Accepted', async function (this: DifyWorld) {
  const page = this.getPage()
  const rejected = page.getByRole('button', { name: 'Rejected', exact: true })
  const accepted = page.getByRole('button', { name: 'Accepted', exact: true })

  await rejected.dragTo(accepted)
  await expect(page.getByRole('button', { name: /^(Rejected|Accepted)$/ })).toHaveText([
    'Rejected',
    'Accepted',
  ])
})

Then(
  'the Agent output route order should be saved as Rejected then Accepted',
  async function (this: DifyWorld) {
    const appId = this.createdAppIds.at(-1)
    if (!appId) throw new Error('Create an Agent output routes workflow first.')

    await expect
      .poll(
        async () => {
          const data = await getAgentV2WorkflowNodeData(this.getConsoleClient(), appId)
          return zWorkflowOutputRoutes
            .parse(data.agent_output_routes)
            .routes?.map((route) => route.id)
        },
        { timeout: 30_000 },
      )
      .toEqual(['rejected', 'accepted'])
  },
)

When('I insert the routed Agent snippet between Start and End', async function (this: DifyWorld) {
  const page = this.getPage()
  const snippet = this.agentBuilder.workflow.outputRouteSnippet
  if (!snippet) throw new Error('Create an Agent output routes snippet first.')

  const connection = page.getByRole('button', { name: 'Connection from Start to End', exact: true })
  await expect(connection).toBeVisible({ timeout: 30_000 })
  const bounds = await connection.boundingBox()
  if (!bounds) throw new Error('The Start to End connection has no visible bounds.')
  // The Add Node control overlays the middle of the connection when it is hovered.
  await connection.hover({ position: { x: bounds.width / 4, y: bounds.height / 2 } })
  await page
    .locator('.react-flow__edgelabel-renderer')
    .getByRole('button', { name: 'Add Node', exact: true })
    .click()
  await page.getByRole('tab', { name: 'Snippets', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search snippets...' }).fill(snippet.name)
  await page.getByRole('button', { name: snippet.name, exact: true }).click()
  await expect(page.getByTitle('Agent', { exact: true })).toBeVisible()
})

Then(
  'the inserted Agent should receive the Start connection and leave its output routes unconnected',
  async function (this: DifyWorld) {
    const appId = this.createdAppIds.at(-1)
    if (!appId) throw new Error('Create the destination workflow first.')

    await expect(
      this.getPage().getByLabel('Connection from Start to Agent', { exact: true }),
    ).toBeVisible()
    await expect
      .poll(
        async () => {
          const draft = await this.getConsoleClient().apps.byAppId.workflows.draft.get({
            params: { app_id: appId },
          })
          const graph = zSnippetInsertionGraph.parse(draft.graph)
          const agent = graph.nodes.find((node) => node.data.title === 'Agent')
          return {
            inserted: !!agent,
            incoming: graph.edges.filter(
              (edge) => edge.source === 'start' && edge.target === agent?.id,
            ).length,
            outgoing: graph.edges.filter((edge) => edge.source === agent?.id).length,
          }
        },
        { timeout: 30_000 },
      )
      .toEqual({ inserted: true, incoming: 1, outgoing: 0 })
  },
)

Then(
  'the Agent output route editor should show Rejected before Accepted',
  async function (this: DifyWorld) {
    await expect(this.getPage().getByRole('button', { name: /^(Rejected|Accepted)$/ })).toHaveText([
      'Rejected',
      'Accepted',
    ])
  },
)

When(
  'I disable the Agent output routes and undo the saved change once',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const appId = this.createdAppIds.at(-1)
    if (!appId) throw new Error('Create an Agent output routes workflow first.')

    const outputRoutes = page.getByRole('switch', { name: 'Output Routes', exact: true })
    await expect(outputRoutes).toBeChecked()
    await outputRoutes.click()
    await expect(outputRoutes).not.toBeChecked()
    await expect
      .poll(
        async () => {
          const data = await getAgentV2WorkflowNodeData(this.getConsoleClient(), appId)
          return zWorkflowOutputRoutes.parse(data.agent_output_routes).enabled
        },
        { timeout: 30_000 },
      )
      .toBe(false)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
  },
)

Then(
  'the Agent output routes and both successful connections should be restored',
  async function (this: DifyWorld) {
    const page = this.getPage()
    await expect(page.getByRole('switch', { name: 'Output Routes', exact: true })).toBeChecked()
    for (const route of ['Accepted', 'Rejected']) {
      await expect(
        page.getByRole('button', {
          name: `Connection from Agent (${route}) to ${route} result`,
          exact: true,
        }),
      ).toBeVisible()
    }
  },
)
