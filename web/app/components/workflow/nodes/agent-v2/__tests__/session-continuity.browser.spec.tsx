import type { AgentV2NodeType } from '../types'
import type { Node } from '@/app/components/workflow/types'
import { useState } from 'react'
import ReactFlow, { useNodes } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { FeaturesProvider } from '@/app/components/base/features/context'
import { useNodesSyncDraft } from '@/app/components/workflow-app/hooks/use-nodes-sync-draft'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowBrowserComponent } from '@/app/components/workflow/__tests__/workflow-browser-test-env'
import UndoRedo from '@/app/components/workflow/header/undo-redo'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { createHooksStore } from '@/app/components/workflow/hooks-store/store'
import { useNodesInteractions } from '@/app/components/workflow/hooks/use-nodes-interactions'
import { BlockEnum } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import englishCopy from '@/i18n/locales/en-US/workflow-agent.json'
import japaneseCopy from '@/i18n/locales/ja-JP/workflow-agent.json'
import chineseCopy from '@/i18n/locales/zh-Hans/workflow-agent.json'
import { consoleQuery } from '@/service/console'
import { TEST_AGENT_ID, TEST_APP_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { createAgentFixture } from '@/test/fixtures/agent'
import { createTestNavigation } from '@/test/next-navigation'
import { AgentV2Panel } from '../panel'

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
const title = 'workflowAgent.nodes.agent.sessionContinuity.title'
const description = 'workflowAgent.nodes.agent.sessionContinuity.description'
const taskLabel = 'workflowAgent.nodes.agent.task.label'

const createAgentNode = (id: string, data: Partial<AgentV2NodeType> = {}) =>
  createNode({
    id,
    type: 'default',
    data: {
      title: id,
      type: BlockEnum.AgentV2,
      version: '2',
      agent_node_kind: 'dify_agent',
      agent_binding: { binding_type: 'roster_agent', agent_id: TEST_AGENT_ID },
      ...data,
    },
  })

function HistoryControls() {
  const { handleHistoryBack, handleHistoryForward } = useNodesInteractions()
  return <UndoRedo handleUndo={handleHistoryBack} handleRedo={handleHistoryForward} />
}

function Panels({ nodes, showHistory }: { nodes: Node[]; showHistory: boolean }) {
  const [selectedId, setSelectedId] = useState(nodes[0]?.id)
  const selected = useNodes<AgentV2NodeType>().find((node) => node.id === selectedId)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const [hooks] = useState(() => createHooksStore({ doSyncWorkflowDraft }))

  return (
    <HooksStoreContext value={hooks}>
      {showHistory && <HistoryControls />}
      {nodes.length > 1 &&
        nodes.map(({ id }) => (
          <button key={id} type="button" onClick={() => setSelectedId(id)}>
            Edit {id}
          </button>
        ))}
      {selected && (
        <AgentV2Panel
          key={selected.id}
          id={selected.id}
          data={selected.data}
          panelProps={{
            getInputVars: () => [],
            toVarInputs: () => [],
            runInputData: {},
            runInputDataRef: { current: {} },
            setRunInputData: () => {},
            runResult: null,
          }}
        />
      )}
    </HooksStoreContext>
  )
}

async function renderPanel({
  mode = 'advanced-chat',
  nodes = [createAgentNode('Agent A')],
  readOnly = false,
  showHistory = false,
}: {
  mode?: 'advanced-chat' | 'workflow'
  nodes?: Node[]
  readOnly?: boolean
  showHistory?: boolean
} = {}) {
  const { NavigationProvider } = createTestNavigation({ url: `/app/${TEST_APP_ID}/workflow` })
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  queryClient.setQueryData(
    consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: TEST_AGENT_ID } } }),
    createAgentFixture({ name: 'Nadia' }),
  )
  onTestFinished(() => queryClient.clear())
  const screen = await renderWorkflowBrowserComponent(
    <NavigationProvider>
      <FeaturesProvider>
        <EventEmitterContextProvider>
          <div className="h-px w-105">
            <ReactFlow defaultNodes={nodes} />
          </div>
          <div className="w-105">
            <Panels nodes={nodes} showHistory={showHistory} />
          </div>
        </EventEmitterContextProvider>
      </FeaturesProvider>
    </NavigationProvider>,
    {
      resource: { kind: 'app', appId: TEST_APP_ID, mode, collaborationEnabled: false },
      queryClient,
      historyStore: { nodes },
      initialStoreState: {
        canvasReadOnly: readOnly,
        isWorkflowDataLoaded: true,
        syncWorkflowDraftHash: 'initial',
      },
    },
  )
  onTestFinished(() => screen.store.getState().debouncedSyncWorkflowDraft.cancel?.())
  return { ...screen, sessionSwitch: screen.getByRole('switch', { name: title }) }
}

it('keeps the session switch out of standalone Workflow settings', async () => {
  const screen = await renderPanel({ mode: 'workflow' })

  await expect.element(screen.getByRole('textbox', { name: taskLabel })).toBeVisible()
  await expect.element(screen.sessionSwitch).not.toBeInTheDocument()
})

it('lets keyboard users turn a legacy Chatflow node off independently of another node using the same agent', async () => {
  const screen = await renderPanel({
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
  const { sessionSwitch } = await renderPanel({
    nodes: [createAgentNode('Agent A', { continue_agent_session: false })],
    readOnly: true,
  })

  await expect.element(sessionSwitch).toBeDisabled()
  await expect.element(sessionSwitch).not.toBeChecked()
  expect(saveDraft()).not.toHaveBeenCalled()
})

it('saves the explicit default when undoing a previously saved change on a legacy node', async () => {
  const screen = await renderPanel({ showHistory: true })
  const { sessionSwitch } = screen
  const undo = screen.getByRole('button', { name: 'workflow.common.undo' })
  const redo = screen.getByRole('button', { name: 'workflow.common.redo' })

  await sessionSwitch.click()
  await expect.element(sessionSwitch).not.toBeChecked()
  await expect.element(sessionSwitch).toBeEnabled()
  await expect.element(undo).toBeEnabled()
  await undo.click()

  await expect.element(sessionSwitch).toBeChecked()
  await expect
    .poll(() => saveDraft().mock.lastCall?.[0].body.graph.nodes)
    .toEqual([
      expect.objectContaining({ data: expect.objectContaining({ continue_agent_session: true }) }),
    ])

  await redo.click()
  await expect.element(sessionSwitch).not.toBeChecked()
  await expect
    .poll(() => saveDraft().mock.lastCall?.[0].body.graph.nodes)
    .toEqual([
      expect.objectContaining({ data: expect.objectContaining({ continue_agent_session: false }) }),
    ])
  expect(saveDraft()).toHaveBeenCalledTimes(3)
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
  const { sessionSwitch } = await renderPanel({
    nodes: [
      createAgentNode('Inline Agent', { agent_binding: binding, continue_agent_session: false }),
    ],
  })

  await expect.element(sessionSwitch).toBeDisabled()
  await expect.element(sessionSwitch).not.toBeChecked()
  request.release()
  await expect.element(sessionSwitch).toBeEnabled()
  await expect.element(sessionSwitch).not.toBeChecked()

  await sessionSwitch.click()
  await expect.element(sessionSwitch).toBeChecked()
  await expect.element(sessionSwitch).toBeEnabled()
  expect(saveDraft().mock.lastCall?.[0].body.graph.nodes).toEqual([
    expect.objectContaining({
      data: expect.objectContaining({ agent_binding: binding, continue_agent_session: true }),
    }),
  ])
})

it('blocks a second toggle while the draft saves and lets the user retry a failed change', async () => {
  const request = hold(saveDraft())
  const screen = await renderPanel()
  const { sessionSwitch } = screen

  await sessionSwitch.click()
  await expect.element(sessionSwitch).toBeDisabled()
  await expect.element(sessionSwitch).toHaveAttribute('aria-busy', 'true')
  await userEvent.keyboard(' ')
  await expect.poll(() => saveDraft().mock.calls.length).toBe(1)
  request.reject(apiError({ status: 500, message: 'Could not save draft' }))

  const alert = screen.getByRole('alert')
  await expect.element(alert).toMatchTextContent('workflow.common.draftSaveFailed')
  await expect.element(sessionSwitch).toBeChecked()
  await screen.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(alert).not.toBeInTheDocument()
  await expect.element(sessionSwitch).not.toBeChecked()
  await expect.element(sessionSwitch).toBeEnabled()
  expect(saveDraft()).toHaveBeenCalledTimes(2)
  expect(saveDraft().mock.lastCall?.[0].body).toMatchObject({
    hash: 'initial',
    graph: {
      nodes: [
        expect.objectContaining({
          data: expect.objectContaining({ continue_agent_session: false }),
        }),
      ],
    },
  })
})

it('preserves a saved off setting when the task, routes and outputs are edited', async () => {
  const screen = await renderPanel()
  const { sessionSwitch } = screen

  await sessionSwitch.click()
  await expect.element(sessionSwitch).not.toBeChecked()
  await expect.element(sessionSwitch).toBeEnabled()

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
    const screen = await renderPanel()
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
