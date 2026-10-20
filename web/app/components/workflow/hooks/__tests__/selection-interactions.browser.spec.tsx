import type { ContextMenuActions } from '@langgenius/dify-ui/context-menu'
import type { AvailableNodesMetaData } from '../../hooks-store'
import { ContextMenu, ContextMenuTrigger } from '@langgenius/dify-ui/context-menu'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { use, useLayoutEffect, useRef } from 'react'
import ReactFlow, { ReactFlowProvider } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { WorkflowContext } from '../../context'
import { EditorResourceScope } from '../../editor-resource/provider'
import { HooksStoreContext } from '../../hooks-store/provider'
import { createHooksStore } from '../../hooks-store/store'
import { useWorkflowNodeCatalog } from '../../node-catalog'
import codeDefault from '../../nodes/code/default'
import { SelectionContextmenu } from '../../selection-contextmenu'
import { createWorkflowStore } from '../../store/workflow'
import { BlockEnum } from '../../types'
import { parseWorkflowClipboardText } from '../../utils/clipboard'
import { useNodesInteractions } from '../use-nodes-interactions'
import { useSelectionInteractions } from '../use-selection-interactions'
import 'reactflow/dist/style.css'

vi.mock('@/next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/next/navigation')>()
  return {
    ...actual,
    useRouter: () =>
      ({
        bfcacheId: 'test-router',
        push: vi.fn(),
        replace: vi.fn(),
        back: vi.fn(),
        forward: vi.fn(),
        refresh: vi.fn(),
        prefetch: vi.fn(),
      }) satisfies ReturnType<typeof actual.useRouter>,
  }
})

const nodes = [
  createNode({
    id: 'one',
    type: 'default',
    position: { x: 100, y: 100 },
    data: { ...codeDefault.defaultValue, type: BlockEnum.Code, title: 'First', label: 'First' },
  }),
  createNode({
    id: 'two',
    type: 'default',
    position: { x: 300, y: 200 },
    data: { ...codeDefault.defaultValue, type: BlockEnum.Code, title: 'Second', label: 'Second' },
  }),
  createNode({
    id: 'outside',
    type: 'default',
    position: { x: 600, y: 350 },
    data: { ...codeDefault.defaultValue, type: BlockEnum.Code, title: 'Outside', label: 'Outside' },
  }),
]
const edges = [createEdge({ id: 'between', type: 'default', source: 'one', target: 'two' })]
function SelectionCanvas() {
  const catalog = useWorkflowNodeCatalog()
  const hooksStore = use(HooksStoreContext)!
  useLayoutEffect(() => {
    // The editor's legacy store type requires a complete map; use its real catalog.
    const nodesMap = catalog.nodesMap as NonNullable<AvailableNodesMetaData['nodesMap']>
    hooksStore.setState({
      availableNodesMetaData: {
        nodes: catalog.nodes.map((node) => nodesMap[node.metaData.type]),
        nodesMap,
      },
    })
  }, [catalog, hooksStore])
  const menuRef = useRef<ContextMenuActions>(null)
  const selection = useSelectionInteractions()
  const { handleNodesCopy } = useNodesInteractions()
  return (
    <>
      <button onClick={() => handleNodesCopy()}>Copy selection</button>
      <button onClick={selection.handleSelectionCancel}>Cancel selection</button>
      <ContextMenu actionsRef={menuRef}>
        <ContextMenuTrigger render={<div style={{ width: 900, height: 550 }} />}>
          <ReactFlow
            defaultNodes={nodes}
            defaultEdges={edges}
            role="region"
            aria-label="Workflow selection"
            selectionOnDrag
            panOnDrag={false}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            onSelectionStart={selection.handleSelectionStart}
            onSelectionChange={selection.handleSelectionChange}
            onSelectionDrag={selection.handleSelectionDrag}
            onSelectionContextMenu={selection.handleSelectionContextMenu}
          />
        </ContextMenuTrigger>
        <SelectionContextmenu onClose={() => menuRef.current?.close()} />
      </ContextMenu>
    </>
  )
}

async function setup() {
  await page.viewport(1100, 750)
  const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: [],
    appDslVersion: '0.6.0',
    systemFeatures: { enable_collaboration_mode: false },
  })
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppDetailFixture({ mode: 'workflow' }),
  )
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const screen = await render(
    <NuqsTestingAdapter>
      <Wrapper>
        <EditorResourceScope resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}>
          <WorkflowContext value={createWorkflowStore({})}>
            <HooksStoreContext value={createHooksStore({})}>
              <ReactFlowProvider>
                <SelectionCanvas />
              </ReactFlowProvider>
            </HooksStoreContext>
          </WorkflowContext>
        </EditorResourceScope>
      </Wrapper>
    </NuqsTestingAdapter>,
  )
  return { screen, write }
}
afterEach(() => vi.restoreAllMocks())

it('copies only the boxed nodes and connecting edge, moves the group, and clears the copy selection on cancel', async () => {
  // Native selection creates the React Flow rectangle and drag callbacks; manually
  // assigning its internal store cannot prove that Dify bundles the actual graph.
  const { screen, write } = await setup()
  const canvas = screen.getByRole('region', { name: 'Workflow selection' })
  const first = screen.getByRole('button', { name: 'First' })
  const second = screen.getByRole('button', { name: 'Second' })
  const outside = screen.getByRole('button', { name: 'Outside' })
  await expect.element(first).toBeVisible()
  await expect.element(second).toBeVisible()
  await expect.element(outside).toBeVisible()
  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 60, y: 60 },
    targetPosition: { x: 500, y: 280 },
    steps: 8,
  })
  await screen.getByRole('button', { name: 'Copy selection' }).click()
  await expect.poll(() => write.mock.calls.length).toBe(1)
  const copied = parseWorkflowClipboardText(write.mock.calls[0]![0], '0.6.0')
  expect(copied.nodes.map((node) => node.id).sort()).toEqual(['one', 'two'])
  expect(copied.edges.map((edge) => edge.id)).toEqual(['between'])
  const before = [first, second, outside].map((node) => node.element().getBoundingClientRect())
  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 260, y: 170 },
    targetPosition: { x: 310, y: 210 },
    steps: 8,
  })
  await expect
    .poll(() => first.element().getBoundingClientRect().x - before[0]!.x)
    .toBeCloseTo(50, 0)
  expect(second.element().getBoundingClientRect().x - before[1]!.x).toBeCloseTo(50, 0)
  expect(first.element().getBoundingClientRect().y - before[0]!.y).toBeCloseTo(40, 0)
  expect(outside.element().getBoundingClientRect().x).toBeCloseTo(before[2]!.x, 0)
  await canvas.click({ button: 'right', position: { x: 310, y: 210 } })
  await expect.element(screen.getByRole('menuitem', { name: /workflow.common.copy/ })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await userEvent.dragAndDrop(canvas, canvas, {
    sourcePosition: { x: 560, y: 320 },
    targetPosition: { x: 800, y: 450 },
    steps: 8,
  })
  await screen.getByRole('button', { name: 'Copy selection' }).click()
  await expect.poll(() => write.mock.calls.length).toBe(2)
  const replacement = parseWorkflowClipboardText(write.mock.calls[1]![0], '0.6.0')
  expect(replacement.nodes.map((node) => node.id)).toEqual(['outside'])
  expect(replacement.edges).toEqual([])
  await screen.getByRole('button', { name: 'Cancel selection' }).click()
  await screen.getByRole('button', { name: 'Copy selection' }).click()
  expect(write).toHaveBeenCalledTimes(2)
})
