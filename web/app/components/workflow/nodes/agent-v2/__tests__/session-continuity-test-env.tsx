import type { ReactNode } from 'react'
import type { AgentV2NodeType } from '../types'
import type { Node } from '@/app/components/workflow/types'
import { useState } from 'react'
import ReactFlow, { useNodes } from 'reactflow'
import { FeaturesProvider } from '@/app/components/base/features/context'
import { useNodesSyncDraft } from '@/app/components/workflow-app/hooks/use-nodes-sync-draft'
import { useWorkflowRun } from '@/app/components/workflow-app/hooks/use-workflow-run'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowBrowserComponent } from '@/app/components/workflow/__tests__/workflow-browser-test-env'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { createHooksStore } from '@/app/components/workflow/hooks-store/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { TEST_AGENT_ID, TEST_APP_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAgentFixture } from '@/test/fixtures/agent'
import { createTestNavigation } from '@/test/next-navigation'
import { AgentV2Panel } from '../panel'

export const sessionContinuityTitle = 'workflowAgent.nodes.agent.sessionContinuity.title'

export const createAgentNode = (id: string, data: Partial<AgentV2NodeType> = {}) =>
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

export async function renderSessionContinuityPanel({
  mode = 'advanced-chat',
  nodes = [createAgentNode('Agent A')],
  readOnly = false,
  controls,
}: {
  mode?: 'advanced-chat' | 'workflow'
  nodes?: Node[]
  readOnly?: boolean
  controls?: ReactNode
} = {}) {
  function Panels() {
    const [selectedId, setSelectedId] = useState(nodes[0]?.id)
    const selected = useNodes<AgentV2NodeType>().find((node) => node.id === selectedId)
    const { doSyncWorkflowDraft } = useNodesSyncDraft()
    const run = useWorkflowRun()
    const [hooks] = useState(() => createHooksStore({ ...run, doSyncWorkflowDraft }))

    return (
      <HooksStoreContext value={hooks}>
        {controls}
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
            <Panels />
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
  return { ...screen, sessionSwitch: screen.getByRole('switch', { name: sessionContinuityTitle }) }
}
