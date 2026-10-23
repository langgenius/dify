import type { ReactElement } from 'react'
import type { NodeProps } from 'reactflow'
import type { CommonNodeType } from '../../../../types'
import ReactFlow from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render as renderBrowser } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { EditorResourceScope } from '../../../../editor-resource/provider'
import { BlockEnum } from '../../../../types'
import NodeControl from '../node-control'
import { NodeSourceHandle, NodeTargetHandle } from '../node-handle'
import 'reactflow/dist/style.css'

const render = (ui: ReactElement) => {
  const queryClient = createTestQueryClient()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.rag.pipelines.recommendedPlugins.get.queryKey(), {
    installed_recommended_plugins: [],
    uninstalled_recommended_plugins: [],
  })
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppDetailFixture({ id: 'app-1', mode: 'workflow' }),
  )
  return renderBrowser(
    <QueryClientTestProvider queryClient={queryClient}>
      <EditorResourceScope resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}>
        {ui}
      </EditorResourceScope>
    </QueryClientTestProvider>,
  )
}

// Plugin installation is outside node trigger and popup focus ownership.
vi.mock('@/app/components/plugins/install-plugin/install-from-marketplace', () => ({
  default: () => null,
}))

vi.mock('../../../../hooks/use-available-blocks', () => ({
  useAvailableBlocks: () => ({
    availablePrevBlocks: [BlockEnum.Code],
    availableNextBlocks: [BlockEnum.Code],
  }),
}))
vi.mock('../../../../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({ handleNodeAdd: vi.fn(), handleNodeSelect: vi.fn() }),
}))
vi.mock('../../../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false, getNodesReadOnly: () => false }),
}))
vi.mock('../../../../hooks/use-nodes-meta-data', () => ({
  useNodeMetaData: () => ({
    isTypeFixed: true,
    isUndeletable: false,
    isSingleton: false,
    description: 'Code',
    author: 'Dify',
  }),
}))
vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ nodes: [], dataSourceList: [], shouldAutoOpenStartNodeSelector: false }),
  useWorkflowStore: () => ({ getState: () => ({}) }),
}))
vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      availableNodesMetaData: { nodes: [] },
      accessControl: { canRun: false },
    }),
}))
vi.mock('@/service/use-plugins', () => ({
  useInvalidateCheckInstalled: () => vi.fn(),
  useFeaturedToolsRecommendations: () => ({ plugins: [], isLoading: false }),
  useFeaturedTriggersRecommendations: () => ({ plugins: [], isLoading: false }),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({ data: [] }),
  useInvalidateAllTriggerPlugins: () => vi.fn(),
}))

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: () => ({ data: undefined }),
}))

function FocusNode({ id, data }: NodeProps<CommonNodeType>) {
  return (
    <div className="group relative h-24 w-60 bg-components-panel-bg">
      <NodeControl id={id} data={data} />
      <NodeSourceHandle id={id} data={data} handleId="source" />
      <NodeTargetHandle id={id} data={data} handleId="target" />
      <span>Code node</span>
    </div>
  )
}
const nodeTypes = { focus: FocusNode }
async function renderCanvas() {
  await page.viewport(1000, 800)
  return render(
    <>
      <button type="button">Before canvas</button>

      <div style={{ width: 800, height: 600 }}>
        <ReactFlow
          defaultNodes={[
            {
              id: 'node',
              type: 'focus',
              ariaLabel: 'Code node',
              position: { x: 150, y: 150 },
              data: { type: BlockEnum.Code, title: 'Code', desc: '', selected: false },
            },
          ]}
          nodeTypes={nodeTypes}
        />
      </div>
      <input aria-label="Outside editor" />
    </>,
  )
}

it.each([0, 1])(
  'restores focus to the visible handle button after a pointer-opened popup closes (%s)',
  async (index) => {
    const screen = await renderCanvas()
    const before = screen.getByRole('button', { name: 'Before canvas' })
    const node = screen.getByRole('button', { name: 'Code node', exact: true })
    const trigger = screen.getByRole('button', { name: 'workflow.common.addBlock' }).nth(index)
    await before.click()
    await expect.element(trigger).toBeInTheDocument()
    expect(trigger.element().checkVisibility({ checkOpacity: true })).toBe(false)
    await userEvent.tab()
    await expect.element(node).toHaveFocus()
    // Click the real React Flow handle: its transparent button intentionally does not receive pointer events.
    await userEvent.click(trigger.element().parentElement!)
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    await screen.getByRole('dialog').hover()
    await userEvent.keyboard('{Escape}')
    await expect.element(trigger).toHaveFocus()
    await expect.poll(() => trigger.element().checkVisibility({ checkOpacity: true })).toBe(true)
  },
)

it('keeps More visible and focused after closing an unselected node menu away from hover', async () => {
  const screen = await renderCanvas()
  const before = screen.getByRole('button', { name: 'Before canvas' })
  const more = screen.getByRole('button', { name: 'common.operation.more' })
  await before.click()
  await expect.element(more).toBeInTheDocument()
  expect(more.element().checkVisibility({ checkOpacity: true })).toBe(false)
  await screen.getByRole('button', { name: 'Code node', exact: true }).hover()
  await more.click()
  await expect.element(screen.getByRole('menu')).toBeVisible()
  await before.hover()
  await userEvent.keyboard('{Escape}')
  await expect.element(more).toHaveFocus()
  expect(more.element().checkVisibility({ checkOpacity: true })).toBe(true)
})

it.each([0, 1])(
  'preserves an outside input focus after dismissing handle popup (%s)',
  async (index) => {
    const screen = await renderCanvas()
    const trigger = screen.getByRole('button', { name: 'workflow.common.addBlock' }).nth(index)
    const editor = screen.getByRole('textbox', { name: 'Outside editor' })
    const input = editor.element()
    await expect.element(trigger).toBeInTheDocument()
    await userEvent.click(trigger.element().parentElement!)
    await expect.element(screen.getByRole('dialog')).toBeVisible()
    await userEvent.click(input)
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(editor).toHaveFocus()
    await userEvent.keyboard('Node title')
    await expect.element(editor).toHaveValue('Node title')
  },
)
