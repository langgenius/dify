import type { ReactFlowInstance } from 'reactflow'
import type { HttpNodeType } from '../types'
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
import Panel from '../panel'
import { AuthorizationType, BodyType, Method } from '../types'

it.each([
  { field: 'headers', keyIndex: 1, valueIndex: 2, key: 'x-token', value: 'abc123' },
  { field: 'params', keyIndex: 3, valueIndex: 4, key: 'page', value: '12345' },
] as const)(
  'keeps the $field row focused and saves the complete value while typing',
  async ({ field, keyIndex, valueIndex, key, value }) => {
    const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper()
    seedModelProviderQueries(queryClient)
    seedToolProviders(queryClient, {
      builtInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    })
    queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
    const data: HttpNodeType = {
      title: 'HTTP Request',
      desc: '',
      type: BlockEnum.HttpRequest,
      variables: [],
      method: Method.get,
      url: 'https://api.example.com',
      authorization: { type: AuthorizationType.none },
      headers: '',
      params: '',
      body: { type: BodyType.none, data: [] },
      timeout: { connect: 5, read: 10, write: 15 },
      ssl_verify: true,
    }
    const store = createWorkflowStore({})
    store.setState({ nodesDefaultConfigs: { [BlockEnum.HttpRequest]: data } })
    const hooks = createHooksStore({ doSyncWorkflowDraft: async () => {} })
    let flow: ReactFlowInstance<HttpNodeType>
    function LivePanel() {
      flow = useReactFlow<HttpNodeType>()
      const node = useNodes<HttpNodeType>().find((item) => item.id === 'http-node')
      return node ? (
        <Panel
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
        <EditorResourceScope resource={{ kind: 'snippet', snippetId: 'http-test' }}>
          <WorkflowContext value={store}>
            <HooksStoreContext value={hooks}>
              <EventEmitterContextProvider>
                <ReactFlowProvider>
                  <ReactFlow defaultNodes={[createNode({ id: 'http-node', data })]} />
                  <LivePanel />
                </ReactFlowProvider>
              </EventEmitterContextProvider>
            </HooksStoreContext>
          </WorkflowContext>
        </EditorResourceScope>
      </QueryProvider>,
    )
    const keyInput = screen.getByRole('textbox').nth(keyIndex)
    const valueInput = screen.getByRole('textbox').nth(valueIndex)
    await keyInput.click()
    await userEvent.keyboard(key)
    await expect.element(keyInput).toHaveTextContent(key)
    await valueInput.click()
    await expect.element(valueInput).toHaveFocus()
    await userEvent.keyboard(value[0]!)
    await expect.element(valueInput).toHaveFocus()
    await userEvent.keyboard(value.slice(1))
    await expect.element(valueInput).toHaveTextContent(value)
    await expect.element(valueInput).toHaveFocus()
    await expect.element(keyInput).toHaveTextContent(key)
    await expect.poll(() => flow.getNode('http-node')!.data[field]).toBe(`${key}:${value}`)
    queryClient.clear()
  },
)
