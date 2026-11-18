import type { Page } from '@playwright/test'
import type { DifyWorld } from '../features/support/world.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import * as z from 'zod'
import { baseURL, defaultLocale } from '../test-env.ts'
import { createTestApp } from './api/apps.ts'
import { createConsoleClient } from './api/console-client.ts'
import { createE2EResourceName } from './naming.ts'
import { observeWorkflowDraftNetwork } from './workflow-draft-network.ts'

export const originalPrompt = 'Original prompt for the workflow. '.repeat(24).trim()
export const nodeId = 'e2e-llm'
export const answerNodeId = 'e2e-answer'
export const answerTitle = 'Draft answer'

const zDraftGraph = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      data: z.object({
        title: z.string(),
        prompt_template: z.array(z.object({ role: z.string(), text: z.string() })).optional(),
      }),
    }),
  ),
  edges: z.array(z.object({ source: z.string(), target: z.string() })),
})

export function workflowDraft(world: DifyWorld) {
  const current = world.workflowDraft
  if (!current) throw new Error('Create the Chatflow before exercising its draft.')
  return current
}

export function workflowCollaborator(world: DifyWorld) {
  const collaborator = workflowDraft(world).collaborator
  if (!collaborator) throw new Error('Open the second editor session first.')
  return collaborator
}

export async function readPromptDraft(world: DifyWorld) {
  const draft = await world.getConsoleClient().apps.byAppId.workflows.draft.get({
    params: { app_id: workflowDraft(world).appId },
  })
  return { ...draft, graph: zDraftGraph.parse(draft.graph) }
}

export function canvasNodeByTitle(page: Page, title: string) {
  return page.getByRole('button').filter({ has: page.getByText(title, { exact: true }) })
}

export async function preparePromptDraft(
  world: DifyWorld,
  collaboration: boolean,
  prompts = [{ role: 'system', text: originalPrompt }],
) {
  const client = world.getConsoleClient()
  const features = await client.features.get()
  expect(features.workflow_collaboration_enabled).toBe(collaboration)
  const app = await createTestApp(
    client,
    createE2EResourceName('App', 'Prompt draft'),
    'advanced-chat',
  )
  world.createdAppIds.push(app.id)
  world.lastCreatedAppName = app.name
  const network = await observeWorkflowDraftNetwork(world.getPage())
  world.workflowDraft = { appId: app.id, collaboration, network }
  await client.apps.byAppId.workflows.draft.post({
    params: { app_id: app.id },
    body: {
      graph: {
        nodes: [
          {
            id: 'start',
            type: 'custom',
            position: { x: 40, y: 160 },
            data: { type: 'start', title: 'Start', variables: [] },
          },
          {
            id: nodeId,
            type: 'custom',
            position: { x: 360, y: 160 },
            data: {
              type: 'llm',
              title: 'Draft prompt',
              model: {
                provider: 'langgenius/openai/openai',
                name: 'gpt-4o-mini',
                mode: 'chat',
                completion_params: {},
              },
              prompt_template: prompts,
              context: { enabled: false, variable_selector: [] },
              vision: { enabled: false },
              variables: [],
            },
          },
          {
            id: answerNodeId,
            type: 'custom',
            position: { x: 680, y: 160 },
            data: { type: 'answer', title: answerTitle, answer: 'A test answer.', variables: [] },
          },
        ],
        edges: [
          {
            id: 'start-llm',
            type: 'custom',
            source: 'start',
            target: nodeId,
            sourceHandle: 'source',
            targetHandle: 'target',
          },
          {
            id: 'llm-answer',
            type: 'custom',
            source: nodeId,
            target: answerNodeId,
            sourceHandle: 'source',
            targetHandle: 'target',
          },
        ],
        viewport: { x: 0, y: 0, zoom: 0.8 },
      },
      features: {},
      conversation_variables: [],
    },
  })
  return app
}

export async function openCollaboratorSession(world: DifyWorld) {
  const client = world.getConsoleClient()
  const email = `e2e-workflow-${randomUUID()}@example.com`
  const invitation = await client.workspaces.current.members.inviteEmail.post({
    body: { emails: [email], role: 'editor', language: defaultLocale },
  })
  const invited = invitation.invitation_results[0]
  if (invited?.status !== 'success') throw new Error('Could not invite the workflow collaborator.')
  const token = new URL(invited.url, baseURL).searchParams.get('token')
  if (!token) throw new Error('The collaborator invitation did not include a token.')

  const { accounts } = await client.workspaces.current.members.get()
  const member = accounts.find((account) => account.email === email)
  if (!member) throw new Error('The invited collaborator did not join the test workspace.')
  world.registerCleanup(async () => {
    await client.workspaces.current.members.byMemberId.delete({ params: { member_id: member.id } })
  })

  const browser = world.getPage().context().browser()
  if (!browser) throw new Error('The workflow collaborator needs an independent browser context.')
  const context = await browser.newContext({ baseURL, locale: defaultLocale })
  world.registerCleanup(() => context.close())
  const collaborator = createConsoleClient({
    requestContext: context.request,
    requireCsrfToken: false,
  })
  const { result } = await collaborator.login.post({
    body: {
      email,
      invite_token: token,
      password: Buffer.from(`E2eDraft${randomUUID()}`, 'utf8').toString('base64'),
    },
  })
  expect(result).toBe('success')
  await collaborator.activate.post({
    body: {
      token,
      name: 'E2E Workflow Editor',
      interface_language: defaultLocale,
      timezone: 'UTC',
    },
  })
  const profile = await collaborator.account.profile.get()
  expect(profile.id).toBe(member.id)

  const page = await context.newPage()
  const network = await observeWorkflowDraftNetwork(page)
  return { page, network, accountId: profile.id }
}
