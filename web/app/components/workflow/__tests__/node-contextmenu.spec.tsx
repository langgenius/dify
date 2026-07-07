import type { Node } from '../types'
import { ContextMenu } from '@langgenius/dify-ui/context-menu'
import { fireEvent, render, screen } from '@testing-library/react'
import { NodeContextmenu } from '../node-contextmenu'

const mockUseNodes = vi.hoisted(() => vi.fn())
const mockUseStore = vi.hoisted(() => vi.fn())
const mockUseNodeActionsMenuModel = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  __esModule: true,
  default: () => mockUseNodes(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { contextMenuTarget?: { type: 'node', nodeId: string } }) => unknown) => mockUseStore(selector),
}))

vi.mock('@/app/components/workflow/node-actions-menu/use-node-actions-menu-model', () => ({
  useNodeActionsMenuModel: (props: unknown) => mockUseNodeActionsMenuModel(props),
}))

describe('NodeContextmenu', () => {
  const mockClose = vi.fn()
  let contextMenuTarget: { type: 'node', nodeId: string } | undefined
  let nodes: Node[]

  beforeEach(() => {
    vi.clearAllMocks()
    contextMenuTarget = undefined
    nodes = [{
      id: 'node-1',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        title: 'Node 1',
        desc: '',
        type: 'code' as never,
      },
    } as Node]

    mockUseNodes.mockImplementation(() => nodes)
    mockUseStore.mockImplementation((selector: (state: { contextMenuTarget?: { type: 'node', nodeId: string } }) => unknown) => selector({ contextMenuTarget }))
    mockUseNodeActionsMenuModel.mockImplementation((props: { id: string, data: Node['data'], onClose: () => void }) => ({
      about: {
        author: 'Dify',
        description: 'Node actions',
      },
      canChangeBlock: false,
      canRun: false,
      data: props.data,
      handleCopy: props.onClose,
      handleDelete: props.onClose,
      handleDuplicate: props.onClose,
      handleRun: props.onClose,
      helpLinkUri: undefined,
      id: props.id,
      isSingleton: false,
      isUndeletable: false,
      nodesReadOnly: false,
      sourceHandle: 'source',
      workflowAppHref: undefined,
    }))
  })

  const renderNodeContextmenu = () => render(
    <ContextMenu open>
      <NodeContextmenu onClose={mockClose} />
    </ContextMenu>,
  )

  it('should stay hidden when the node menu is absent', () => {
    renderNodeContextmenu()

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(mockUseNodeActionsMenuModel).not.toHaveBeenCalled()
  })

  it('should stay hidden when the referenced node cannot be found', () => {
    contextMenuTarget = { type: 'node', nodeId: 'missing-node' }

    renderNodeContextmenu()

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(mockUseNodeActionsMenuModel).not.toHaveBeenCalled()
  })

  it('should render the node actions and close from content actions', () => {
    contextMenuTarget = { type: 'node', nodeId: 'node-1' }
    renderNodeContextmenu()

    expect(screen.getByText('WORKFLOW.PANEL.ABOUT')).toBeInTheDocument()
    expect(mockUseNodeActionsMenuModel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'node-1',
      data: expect.objectContaining({ title: 'Node 1' }),
      showHelpLink: true,
    }))

    fireEvent.click(screen.getByRole('menuitem', { name: /workflow\.common\.copy/i }))

    expect(mockClose).toHaveBeenCalledTimes(1)
  })
})
