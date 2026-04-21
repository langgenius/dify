import type { Node } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import NodeContextmenu from '../node-contextmenu'

const mockUseClickAway = vi.hoisted(() => vi.fn())
const mockUseNodes = vi.hoisted(() => vi.fn())
const mockUsePanelInteractions = vi.hoisted(() => vi.fn())
const mockUseStore = vi.hoisted(() => vi.fn())
const mockPanelOperatorPopup = vi.hoisted(() => vi.fn())

vi.mock('ahooks', () => ({
  useClickAway: (...args: unknown[]) => mockUseClickAway(...args),
}))

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  __esModule: true,
  default: () => mockUseNodes(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  usePanelInteractions: () => mockUsePanelInteractions(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { nodeMenu?: { nodeId: string, left: number, top: number } }) => unknown) => mockUseStore(selector),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/panel-operator/panel-operator-popup', () => ({
  __esModule: true,
  default: (props: {
    id: string
    data: Node['data']
    showHelpLink: boolean
    onClosePopup: () => void
  }) => {
    mockPanelOperatorPopup(props)
    return (
      <button type="button" onClick={props.onClosePopup}>
        {props.id}
        :
        {props.data.title}
      </button>
    )
  },
}))

describe('NodeContextmenu', () => {
  const mockHandleNodeContextmenuCancel = vi.fn()
  let nodeMenu: { nodeId: string, left: number, top: number } | undefined
  let nodes: Node[]
  let clickAwayHandler: (() => void) | undefined

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
    clickAwayHandler = undefined

    mockUseClickAway.mockImplementation((handler: () => void) => {
      clickAwayHandler = handler
    })
    mockUseNodes.mockImplementation(() => nodes)
    mockUsePanelInteractions.mockReturnValue({
      handleNodeContextmenuCancel: mockHandleNodeContextmenuCancel,
    })
    mockUseStore.mockImplementation((selector: (state: { nodeMenu?: { nodeId: string, left: number, top: number } }) => unknown) => selector({ nodeMenu }))
  })

  it('should stay hidden when the node menu is absent', () => {
    render(<NodeContextmenu />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(mockPanelOperatorPopup).not.toHaveBeenCalled()
  })

  it('should stay hidden when the referenced node cannot be found', () => {
    nodeMenu = { nodeId: 'missing-node', left: 80, top: 120 }

    render(<NodeContextmenu />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(mockPanelOperatorPopup).not.toHaveBeenCalled()
  })

  it('should render the popup at the stored position and close on popup/click-away actions', () => {
    nodeMenu = { nodeId: 'node-1', left: 80, top: 120 }
    const { container } = render(<NodeContextmenu />)

    expect(screen.getByRole('button')).toHaveTextContent('node-1:Node 1')
    expect(mockPanelOperatorPopup).toHaveBeenCalledWith(expect.objectContaining({
      id: 'node-1',
      data: expect.objectContaining({ title: 'Node 1' }),
      showHelpLink: true,
    }))
    expect(container.firstChild).toHaveStyle({
      left: '80px',
      top: '120px',
    })

    fireEvent.click(screen.getByRole('button'))
    clickAwayHandler?.()

    expect(mockHandleNodeContextmenuCancel).toHaveBeenCalledTimes(2)
  })
})
