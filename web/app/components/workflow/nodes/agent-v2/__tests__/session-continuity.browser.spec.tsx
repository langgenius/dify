import { page, userEvent } from 'vite-plus/test/browser'
import englishCopy from '@/i18n/locales/en-US/workflow-agent.json'
import japaneseCopy from '@/i18n/locales/ja-JP/workflow-agent.json'
import chineseCopy from '@/i18n/locales/zh-Hans/workflow-agent.json'
import { TEST_AGENT_ID, TEST_APP_ID } from '@/test/console/ids'
import { hold, setupFakeApi } from '@/test/fake-api'
import {
  createAgentNode,
  renderSessionContinuityPanel,
  sessionContinuityTitle as title,
} from './session-continuity-test-env'

const translations = vi.hoisted((): Record<string, string> => ({}))

// boundary: load the shipped locale strings for the narrow panel's text wrapping checks.
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  ...(await import('@/test/i18n-mock')).createReactI18nextMock(translations),
}))

const fake = setupFakeApi({
  console: {
    apps: {
      byAppId: {
        trace: { get: () => ({ enabled: false }) },
        workflows: {
          draft: {
            post: ({ body }) => ({
              hash: `${body.hash}-saved`,
              result: 'success',
              updated_at: 1,
            }),
          },
        },
      },
    },
  },
})

const saveDraft = () => fake.console.apps.byAppId.workflows.draft.post
const description = 'workflowAgent.nodes.agent.sessionContinuity.description'
const taskLabel = 'workflowAgent.nodes.agent.task.label'

it('keeps the session switch out of standalone Workflow settings', async () => {
  const screen = await renderSessionContinuityPanel({ mode: 'workflow' })

  await expect.element(screen.getByRole('textbox', { name: taskLabel })).toBeVisible()
  await expect.element(screen.sessionSwitch).not.toBeInTheDocument()
})

it('lets keyboard users turn a legacy Chatflow node off independently of another node using the same agent', async () => {
  const screen = await renderSessionContinuityPanel({
    nodes: [createAgentNode('Agent A'), createAgentNode('Agent B')],
  })
  const { sessionSwitch } = screen

  await expect.element(sessionSwitch).toBeChecked()
  await expect.element(sessionSwitch).toHaveAccessibleDescription(description)
  sessionSwitch.element().focus()
  await userEvent.keyboard('{Tab}')
  await expect.element(sessionSwitch).not.toHaveFocus()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(sessionSwitch).toHaveFocus()
  await userEvent.keyboard(' ')

  await expect.element(sessionSwitch).not.toBeChecked()
  await expect.element(sessionSwitch).toBeEnabled()
  await expect.element(sessionSwitch).toHaveAccessibleDescription(description)
  screen.store.getState().flushPendingSync()
  await expect.poll(() => saveDraft().mock.calls.length).toBe(1)
  expect(saveDraft()).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      params: { app_id: TEST_APP_ID },
      body: expect.objectContaining({
        hash: 'initial',
        graph: expect.objectContaining({
          nodes: [
            expect.objectContaining({
              id: 'Agent A',
              data: expect.objectContaining({ continue_agent_session: false }),
            }),
            expect.objectContaining({
              id: 'Agent B',
              data: expect.not.objectContaining({ continue_agent_session: false }),
            }),
          ],
        }),
      }),
    }),
  )

  await screen.getByRole('button', { name: 'Edit Agent B' }).click()
  await expect.element(sessionSwitch).toBeChecked()
  await screen.getByRole('button', { name: 'Edit Agent A' }).click()
  await expect.element(sessionSwitch).not.toBeChecked()
})

it('shows a previously saved off value in a read-only Chatflow', async () => {
  const { sessionSwitch } = await renderSessionContinuityPanel({
    nodes: [createAgentNode('Agent A', { continue_agent_session: false })],
    readOnly: true,
  })

  await expect.element(sessionSwitch).toBeDisabled()
  await expect.element(sessionSwitch).not.toBeChecked()
  expect(saveDraft()).not.toHaveBeenCalled()
})

it('keeps a saved inline node setting while its agent loads', async () => {
  const binding = {
    binding_type: 'inline_agent' as const,
    agent_id: TEST_AGENT_ID,
    current_snapshot_id: 'snapshot-1',
  }
  const inline = fake.use({
    console: {
      apps: {
        byAppId: {
          workflows: {
            draft: {
              nodes: {
                byNodeId: {
                  agentComposer: {
                    get: ({ params }) => ({
                      variant: 'workflow',
                      agent_soul: { schema_version: 1 },
                      node_job: { continue_agent_session: false },
                      save_options: [],
                      soul_lock: { locked: false },
                      agent: {
                        id: TEST_AGENT_ID,
                        name: 'Inline Agent',
                        description: '',
                        scope: 'workflow_only',
                        status: 'active',
                      },
                      binding: {
                        ...binding,
                        id: 'binding-1',
                        node_id: params.node_id,
                        workflow_id: 'workflow-1',
                      },
                    }),
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  const request = hold(inline.console.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get)
  const screen = await renderSessionContinuityPanel({
    nodes: [
      createAgentNode('Inline Agent', { agent_binding: binding, continue_agent_session: false }),
    ],
  })
  const { sessionSwitch } = screen

  await expect.element(sessionSwitch).toBeDisabled()
  await expect.element(sessionSwitch).not.toBeChecked()
  request.release()
  await expect.element(sessionSwitch).toBeEnabled()
  await expect.element(sessionSwitch).not.toBeChecked()

  await sessionSwitch.click()
  await expect.element(sessionSwitch).toBeChecked()
  screen.store.getState().flushPendingSync()
  await expect
    .poll(() => saveDraft().mock.lastCall?.[0].body.graph.nodes)
    .toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ agent_binding: binding, continue_agent_session: true }),
      }),
    ])
})

it('saves the latest switch value through the workflow draft queue', async () => {
  const screen = await renderSessionContinuityPanel()
  const { sessionSwitch } = screen

  await sessionSwitch.click()
  await expect.element(sessionSwitch).not.toBeChecked()
  await sessionSwitch.click()
  await expect.element(sessionSwitch).toBeChecked()
  expect(saveDraft()).not.toHaveBeenCalled()

  screen.store.getState().flushPendingSync()
  await expect
    .poll(() => saveDraft().mock.lastCall?.[0].body.graph.nodes)
    .toMatchObject([{ id: 'Agent A', data: { continue_agent_session: true } }])
  expect(saveDraft()).toHaveBeenCalledTimes(1)
})

it('preserves a saved off setting when the task, routes and outputs are edited', async () => {
  const screen = await renderSessionContinuityPanel()
  const { sessionSwitch } = screen

  await sessionSwitch.click()
  await expect.element(sessionSwitch).not.toBeChecked()
  screen.store.getState().flushPendingSync()
  await expect.poll(() => saveDraft().mock.calls.length).toBe(1)

  const task = screen.getByRole('textbox', { name: taskLabel })
  await task.fill('Generate ')
  const routes = screen.getByRole('switch', { name: 'workflow.nodes.agent.outputRoutes.title' })
  await routes.click()
  await expect.element(routes).toBeChecked()
  await task.click()
  await userEvent.keyboard('{End}/')
  await screen
    .getByRole('button', { name: 'workflowAgent.nodes.agent.outputVars.newOutput' })
    .click()
  const name = screen.getByRole('textbox', {
    name: 'workflowAgent.nodes.agent.outputVars.nameLabel',
  })
  await expect.element(name).toHaveFocus()
  await name.fill('report')
  await userEvent.keyboard('{Enter}')
  await expect.element(name).not.toBeInTheDocument()
  screen.store.getState().flushPendingSync()
  await expect
    .poll(() => saveDraft().mock.lastCall?.[0].body)
    .toMatchObject({
      hash: expect.stringMatching(/^initial-saved/),
      graph: {
        nodes: [
          expect.objectContaining({
            data: expect.objectContaining({
              continue_agent_session: false,
              agent_task: expect.stringContaining('[§output:report:report§]'),
              agent_output_routes: expect.objectContaining({ enabled: true }),
              agent_declared_outputs: [{ name: 'report', type: 'string', required: false }],
            }),
          }),
        ],
      },
    })
  await expect.element(sessionSwitch).not.toBeChecked()
})

it.each([
  ['en-US', englishCopy],
  ['zh-Hans', chineseCopy],
  ['ja-JP', japaneseCopy],
] as const)(
  'wraps the full %s session description within the 420 px panel',
  async (locale, copy) => {
    translations[title] = copy['nodes.agent.sessionContinuity.title']
    translations[description] = copy['nodes.agent.sessionContinuity.description']
    const previousLanguage = document.documentElement.lang
    document.documentElement.lang = locale
    onTestFinished(() => {
      document.documentElement.lang = previousLanguage
      delete translations[title]
      delete translations[description]
    })
    await page.viewport(420, 800)
    const screen = await renderSessionContinuityPanel()
    const text = screen.getByText(translations[description], { exact: true })

    await expect.element(screen.getByRole('switch', { name: translations[title] })).toBeVisible()
    await expect.element(text).toBeVisible()
    await document.fonts.ready
    const paragraph = text.element()
    const bounds = paragraph.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const fragments = Array.from(range.getClientRects())
    const lines = new Set(fragments.map(({ top }) => top)).size

    if (locale === 'en-US') expect(lines).toBe(2)
    else expect(lines).toBeGreaterThan(1)
    for (const fragment of fragments) {
      expect(fragment.left).toBeGreaterThanOrEqual(bounds.left)
      expect(fragment.right).toBeLessThanOrEqual(bounds.right)
      expect(fragment.right).toBeLessThanOrEqual(420)
    }
  },
)
