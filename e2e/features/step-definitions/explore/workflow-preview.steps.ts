import type { DifyWorld } from '../../support/world.ts'
import { Given, Then, When } from '@cucumber/cucumber'
import { zWorkflowOutputRoutes } from '@dify/contracts/api/console/apps/zod.gen'
import { expect } from '@playwright/test'
import * as z from 'zod'
import { defaultLocale } from '../../../test-env.ts'

const fixtureAppIdEnv = 'E2E_AGENT_OUTPUT_ROUTES_PREVIEW_APP_ID'
const zPreviewGraph = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      data: z.object({
        type: z.string(),
        agent_node_kind: z.string().optional(),
        version: z.string().optional(),
        agent_output_routes: zWorkflowOutputRoutes.optional(),
        error_strategy: z.string().optional(),
      }),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      sourceHandle: z.string().nullish(),
      target: z.string(),
    }),
  ),
})

Given(
  'the Cloud catalog contains a published workflow with Agent output routes and a failure branch',
  async function (this: DifyWorld) {
    const appId = process.env[fixtureAppIdEnv]?.trim()
    if (!appId)
      throw new Error(`Set ${fixtureAppIdEnv} to the preseeded E2E workflow template app ID.`)

    const client = this.getConsoleClient()
    const systemFeatures = await client.systemFeatures.get()
    expect(systemFeatures.deployment_edition, 'Template preview requires a Cloud runtime.').toBe(
      'CLOUD',
    )

    const [catalog, app, workflow] = await Promise.all([
      client.explore.apps.get({ query: { language: defaultLocale } }),
      client.trialApps.byAppId.get({ params: { app_id: appId } }),
      client.trialApps.byAppId.workflows.get({ params: { app_id: appId } }),
    ])
    expect(app.name, 'The template fixture must be an E2E-owned resource.').toMatch(/^E2E /)
    expect(app.mode).toBe('workflow')
    expect(
      catalog.recommended_apps
        .filter((item) => item.app?.name === app.name)
        .map((item) => item.app_id),
    ).toEqual([appId])
    expect(workflow.version).toBeTruthy()
    expect(workflow.version).not.toBe('draft')

    const graph = zPreviewGraph.parse(workflow.graph)
    const agents = graph.nodes.filter(
      (node) =>
        node.data.agent_node_kind === 'dify_agent' &&
        node.data.version === '2' &&
        node.data.agent_output_routes?.enabled,
    )
    expect(agents, 'The template must contain exactly one routed Agent.').toHaveLength(1)
    const agent = agents[0]!
    expect(agent.data.error_strategy).toBe('fail-branch')
    const routes = agent.data.agent_output_routes?.routes ?? []
    expect(routes.length).toBeGreaterThanOrEqual(2)

    const edgeForHandle = (handle: string) => {
      const edge = graph.edges.find(
        (item) => item.source === agent.id && item.sourceHandle === handle,
      )
      if (!edge || !graph.nodes.some((node) => node.id === edge.target))
        throw new Error(`Template fixture is missing a valid Agent connection for ${handle}.`)
      return edge.id
    }
    this.workflowPreview = {
      appName: app.name,
      agentNodeId: agent.id,
      failureEdgeId: edgeForHandle('fail-branch'),
      routes: routes.map((route) => {
        if (!route.label?.trim()) throw new Error(`Template route ${route.id} must have a label.`)
        return { edgeId: edgeForHandle(route.id), label: route.label }
      }),
    }
  },
)

When('I open the routed workflow template orchestration details', async function (this: DifyWorld) {
  const fixture = this.workflowPreview
  if (!fixture) throw new Error('Resolve the Cloud workflow template fixture first.')

  const page = this.getPage()
  await page.goto('/')
  await page.getByRole('button', { name: fixture.appName, exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('tab', { name: 'Orchestration Details', exact: true })
    .click()
})

Then(
  'the template preview should show each Agent output route and its connection alongside the failure branch',
  async function (this: DifyWorld) {
    const fixture = this.workflowPreview
    if (!fixture) throw new Error('Resolve the Cloud workflow template fixture first.')

    const preview = this.getPage().getByRole('dialog')
    await expect(preview.getByTestId(`rf__edge-${fixture.failureEdgeId}`)).toBeVisible({
      timeout: 30_000,
    })
    const agent = preview.getByTestId(`rf__node-${fixture.agentNodeId}`)
    for (const route of fixture.routes) {
      await expect(preview.getByTestId(`rf__edge-${route.edgeId}`)).toBeVisible()
      await expect(agent.getByText(route.label, { exact: true })).toBeVisible()
    }
  },
)
