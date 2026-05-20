import type { Node } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { NodeContextmenu } from '../node-contextmenu'

const mockUseNodes = vi.hoisted(() => vi.fn())
const mockUsePanelInteractions = vi.hoisted(() => vi.fn())
const mockUseStore = vi.hoisted(() => vi.fn())
const mockNodeActionsContextMenuContent = vi.hoisted(() => vi.fn())
const mockContextMenuContent = vi.hoisted(() => vi.fn())

vi.mock('@langgenius/dify-ui/context-menu', () => ({
  ContextMenu: ({ children, onOpenChange }: { children: React.ReactNode, onOpenChange: (open: boolean) => void }) => (
    <div>
      {children}
      <button type="button" onClick={() => onOpenChange(false)}>close-context-menu</button>
    </div>
  ),
  ContextMenuContent: ({ children, positionerProps, popupClassName }: { children: React.ReactNode, positionerProps?: { anchor?: unknown }, popupClassName?: string }) => {
    mockContextMenuContent({ positionerProps, popupClassName })
    return <div>{children}</div>
  },
}))

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  __esModule: true,
  default: () => mockUseNodes(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  usePanelInteractions: () => mockUsePanelInteractions(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { nodeMenu?: { nodeId: string, clientX: number, clientY: number } }) => unknown) => mockUseStore(selector),
}))

vi.mock('@/app/components/workflow/node-actions-menu/context-menu-content', () => ({
  NodeActionsContextMenuContent: (props: {
    id: string
    data: Node['data']
    showHelpLink: boolean
    onClose: () => void
  }) => {
    mockNodeActionsContextMenuContent(props)
    return (
      <button type="button" onClick={props.onClose}>
        {props.id}
        :
        {props.data.title}
      </button>
    )
  },
}))

describe('NodeContextmenu', () => {
  const mockHandleNodeContextmenuCancel = vi.fn()
  let nodeMenu: { nodeId: string, clientX: number, clientY: number } | undefined
  let nodes: Node[]

  beforeEach(() => {
    vi.clearAllMocks()
    nodeMenu = undefined
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
    mockUsePanelInteractions.mockReturnValue({
      handleNodeContextmenuCancel: mockHandleNodeContextmenuCancel,
    })
    mockUseStore.mockImplementation((selector: (state: { nodeMenu?: { nodeId: string, clientX: number, clientY: number } }) => unknown) => selector({ nodeMenu }))
  })

  it('should stay hidden when the node menu is absent', () => {
    render(<NodeContextmenu />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(mockNodeActionsContextMenuContent).not.toHaveBeenCalled()
  })

  it('should stay hidden when the referenced node cannot be found', () => {
    nodeMenu = { nodeId: 'missing-node', clientX: 80, clientY: 120 }

    render(<NodeContextmenu />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(mockNodeActionsContextMenuContent).not.toHaveBeenCalled()
  })

  it('should render the context menu at the stored pointer position and close on content/root actions', () => {
    nodeMenu = { nodeId: 'node-1', clientX: 80, clientY: 120 }
    render(<NodeContextmenu />)

    expect(screen.getByText('node-1:Node 1')).toBeInTheDocument()
    expect(mockNodeActionsContextMenuContent).toHaveBeenCalledWith(expect.objectContaining({
      id: 'node-1',
      data: expect.objectContaining({ title: 'Node 1' }),
      showHelpLink: true,
    }))
    expect(mockContextMenuContent).toHaveBeenCalledWith(expect.objectContaining({
      popupClassName: 'w-[240px] rounded-lg',
    }))
    const anchor = mockContextMenuContent.mock.calls[0]![0].positionerProps.anchor as { getBoundingClientRect: () => DOMRect }
    const rect = anchor.getBoundingClientRect()
    expect(rect.x).toBe(80)
    expect(rect.y).toBe(120)

    fireEvent.click(screen.getByText('node-1:Node 1'))
    fireEvent.click(screen.getByText('close-context-menu'))

    expect(mockHandleNodeContextmenuCancel).toHaveBeenCalledTimes(2)
  })
})
