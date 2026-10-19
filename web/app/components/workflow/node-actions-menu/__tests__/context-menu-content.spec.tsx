import type { AvailableNodesMetaData } from '../../hooks-store'
import { ContextMenu } from '@langgenius/dify-ui/context-menu'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { use, useLayoutEffect } from 'react'
import { useNodes } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { HooksStoreContext } from '../../hooks-store'
import { useNodeMetaData } from '../../hooks/use-nodes-meta-data'
import { useWorkflowNodeCatalog } from '../../node-catalog'
import { NodeActionsContextMenuContent } from '../context-menu-content'

// Node metadata comes from the per-app block registry, which has its own suite.
vi.mock('../../hooks/use-nodes-meta-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-nodes-meta-data')>()

  return {
    ...actual,
    useNodeMetaData: vi.fn(),
  }
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.workflow.get': async () => [],
    }),
  }
})

vi.mock('../change-block-popup', () => ({
  ChangeBlockPopup: () => <div data-testid="node-actions-change-block" />,
}))

const mockUseNodeMetaData = vi.mocked(useNodeMetaData)

// Publishes the real block catalog so copy/duplicate know which nodes are copyable.
const CanvasNodes = () => {
  const catalog = useWorkflowNodeCatalog()
  const hooksStore = use(HooksStoreContext)!
  useLayoutEffect(() => {
    const nodesMap = catalog.nodesMap as NonNullable<AvailableNodesMetaData['nodesMap']>
    hooksStore.setState({
      availableNodesMetaData: {
        nodes: catalog.nodes.map((node) => nodesMap[node.metaData.type]),
        nodesMap,
      },
    })
  }, [catalog, hooksStore])
  const nodes = useNodes()
  return <output aria-label="Canvas nodes">{nodes.map((node) => node.id).join(',')}</output>
}

const canvasNodeIds = () =>
  (screen.getByRole('status', { hidden: true }).textContent ?? '').split(',').filter(Boolean)

const renderContextMenu = (readOnly = false) => {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedModelProviderQueries(queryClient)

  return renderWorkflowFlowComponent(
    <>
      <ContextMenu open>
        <NodeActionsContextMenuContent
          id="node-1"
          data={{ type: BlockEnum.Code, title: 'Code Node', desc: '' }}
          onClose={() => undefined}
          showHelpLink={false}
        />
      </ContextMenu>
      <CanvasNodes />
    </>,
    {
      initialStoreState: { canvasReadOnly: readOnly },
      nodes: [
        createNode({
          id: 'node-1',
          width: 240,
          height: 80,
          data: { type: BlockEnum.Code, title: 'Code Node' },
        }),
      ],
      edges: [],
      queryClient,
    },
  )
}

describe('NodeActionsContextMenuContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodeMetaData.mockReturnValue({
      isTypeFixed: false,
      isSingleton: false,
      isUndeletable: false,
      description: 'Node description',
      author: 'Dify',
      helpLinkUri: 'https://docs.example.com/node',
    } as ReturnType<typeof useNodeMetaData>)
  })

  it.each([
    { name: /workflow\.common\.copy/, clipboard: ['node-1'], nodeCount: 1 },
    { name: /workflow\.common\.duplicate/, clipboard: undefined, nodeCount: 2 },
  ])('runs the $name context-menu item on click', async ({ name, clipboard, nodeCount }) => {
    const user = userEvent.setup()
    const { store } = renderContextMenu()

    await user.click(screen.getByRole('menuitem', { name }))

    if (clipboard)
      expect(store.getState().clipboardElements.map((node) => node.id)).toEqual(clipboard)
    await waitFor(() => expect(canvasNodeIds()).toHaveLength(nodeCount))
  })

  it('hides editing actions and blocks their shortcuts when the canvas is readonly', () => {
    const { store } = renderContextMenu(true)

    expect(
      screen.queryByRole('menuitem', { name: /workflow\.common\.copy/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: /workflow\.common\.duplicate/ }),
    ).not.toBeInTheDocument()

    const modifier = detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'c', ...modifier })
    fireEvent.keyDown(menu, { key: 'd', ...modifier })

    expect(store.getState().clipboardElements).toEqual([])
    expect(canvasNodeIds()).toEqual(['node-1'])
  })
})
