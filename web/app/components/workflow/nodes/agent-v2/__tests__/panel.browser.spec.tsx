import type { ReactFlowInstance } from 'reactflow'
import type { AgentV2NodeType } from '../types'
import ReactFlow, { ReactFlowProvider, useNodes, useReactFlow } from 'reactflow'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowContext } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { createHooksStore } from '@/app/components/workflow/hooks-store/store'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { AgentV2Panel } from '../panel'

it('keeps the new output name focused while graph synchronization updates the task', async () => {
  // The native input must keep focus through Lexical metadata updates and graph rerenders.
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  const store = createWorkflowStore({})
  const hooks = createHooksStore({ doSyncWorkflowDraft: async () => {} })
  const data: AgentV2NodeType = {
    title: 'Agent',
    desc: '',
    type: BlockEnum.AgentV2,
    agent_node_kind: 'dify_agent',
    version: '2',
  }
  let flow: ReactFlowInstance<AgentV2NodeType>
  function Panel() {
    flow = useReactFlow<AgentV2NodeType>()
    const node = useNodes<AgentV2NodeType>().find((node) => node.id === 'agent-node')
    return node ? (
      <AgentV2Panel
        id={node.id}
        data={node.data}
        panelProps={{
          getInputVars: () => [],
          toVarInputs: () => [],
          runInputData: {},
          runInputDataRef: { current: {} },
          setRunInputData: () => {},
          runResult: null,
        }}
      />
    ) : null
  }
  const screen = await render(
    <QueryProvider>
      <EditorResourceScope resource={{ kind: 'snippet', snippetId: 'output-test' }}>
        <WorkflowContext value={store}>
          <HooksStoreContext value={hooks}>
            <EventEmitterContextProvider>
              <ReactFlowProvider>
                <ReactFlow defaultNodes={[createNode({ id: 'agent-node', data })]} />
                <Panel />
              </ReactFlowProvider>
            </EventEmitterContextProvider>
          </HooksStoreContext>
        </WorkflowContext>
      </EditorResourceScope>
    </QueryProvider>,
  )
  const task = screen.getByRole('textbox', { name: 'workflowAgent.nodes.agent.task.label' })
  await task.fill('Generate ')
  await userEvent.keyboard('/')
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
    .poll(() => flow.getNode('agent-node')!.data.agent_declared_outputs)
    .toEqual([{ name: 'report', type: 'string', required: false }])
  await expect
    .poll(() => flow.getNode('agent-node')!.data.agent_task)
    .toContain('[§output:report:report§]')
  queryClient.clear()
})
