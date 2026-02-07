import type { ReactNode } from 'react'
import type { ContextMenuState } from '@/app/components/workflow/store/workflow/skill-editor/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { CONTEXT_MENU_TYPE, NODE_MENU_TYPE, ROOT_ID } from '../../constants'
import TreeContextMenu from './tree-context-menu'

type MockWorkflowState = {
  contextMenu: ContextMenuState | null
}

type FloatingOptions = {
  open: boolean
  onOpenChange: (open: boolean) => void
  position: {
    x: number
    y: number
  }
}

const mocks = vi.hoisted(() => ({
  storeState: {
    contextMenu: null,
  } as MockWorkflowState,
  setContextMenu: vi.fn(),
  floatingOptions: null as FloatingOptions | null,
  getFloatingProps: vi.fn(() => ({ 'data-floating-props': 'applied' })),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: MockWorkflowState) => unknown) => selector(mocks.storeState),
  useWorkflowStore: () => ({
    getState: () => ({
      setContextMenu: mocks.setContextMenu,
    }),
  }),
}))

vi.mock('@floating-ui/react', () => ({
  FloatingPortal: ({ children }: { children: ReactNode }) => (
    <div data-testid="floating-portal">{children}</div>
  ),
}))

vi.mock('@/app/components/base/portal-to-follow-elem/use-context-menu-floating', () => ({
  useContextMenuFloating: (options: FloatingOptions) => {
    mocks.floatingOptions = options
    return {
      refs: {
        setFloating: vi.fn(),
      },
      floatingStyles: {
        left: `${options.position.x}px`,
        top: `${options.position.y}px`,
      },
      getFloatingProps: mocks.getFloatingProps,
      isPositioned: true,
    }
  },
}))

vi.mock('./node-menu', () => ({
  default: ({
    type,
    nodeId,
    onClose,
  }: {
    type: string
    nodeId?: string
    onClose: () => void
  }) => (
    <div data-testid="node-menu" data-type={type} data-node-id={nodeId ?? ''}>
      <button type="button" onClick={onClose}>close</button>
    </div>
  ),
}))

const setContextMenuState = (contextMenu: ContextMenuState | null) => {
  mocks.storeState.contextMenu = contextMenu
}

describe('TreeContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.floatingOptions = null
    setContextMenuState(null)
  })

  // Rendering should depend on context-menu state in the workflow store.
  describe('Rendering', () => {
    it('should render nothing when context menu state is null', () => {
      render(<TreeContextMenu treeRef={{ current: null }} />)

      expect(screen.queryByTestId('node-menu')).not.toBeInTheDocument()
      expect(screen.queryByTestId('floating-portal')).not.toBeInTheDocument()
    })

    it('should render file menu with node id when node context is on a file', () => {
      setContextMenuState({
        top: 40,
        left: 24,
        type: CONTEXT_MENU_TYPE.NODE,
        nodeId: 'file-1',
        isFolder: false,
      })

      render(<TreeContextMenu treeRef={{ current: null }} />)

      const menu = screen.getByTestId('node-menu')
      expect(menu).toHaveAttribute('data-type', NODE_MENU_TYPE.FILE)
      expect(menu).toHaveAttribute('data-node-id', 'file-1')
      expect(menu.parentElement).toHaveStyle({
        left: '24px',
        top: '40px',
        visibility: 'visible',
      })
      expect(mocks.getFloatingProps).toHaveBeenCalledTimes(1)
      expect(mocks.floatingOptions?.open).toBe(true)
      expect(mocks.floatingOptions?.position).toEqual({ x: 24, y: 40 })
    })

    it('should render root menu with root id when context is blank area', () => {
      setContextMenuState({
        top: 100,
        left: 80,
        type: CONTEXT_MENU_TYPE.BLANK,
      })

      render(<TreeContextMenu treeRef={{ current: null }} />)

      const menu = screen.getByTestId('node-menu')
      expect(menu).toHaveAttribute('data-type', NODE_MENU_TYPE.ROOT)
      expect(menu).toHaveAttribute('data-node-id', ROOT_ID)
    })
  })

  // Close events from floating layer and menu should reset store context menu.
  describe('Closing behavior', () => {
    it('should clear context menu when floating layer requests close', () => {
      setContextMenuState({
        top: 12,
        left: 16,
        type: CONTEXT_MENU_TYPE.NODE,
        nodeId: 'file-1',
        isFolder: false,
      })

      render(<TreeContextMenu treeRef={{ current: null }} />)

      act(() => {
        mocks.floatingOptions?.onOpenChange(false)
      })

      expect(mocks.setContextMenu).toHaveBeenCalledTimes(1)
      expect(mocks.setContextMenu).toHaveBeenCalledWith(null)
    })

    it('should clear context menu when node menu closes', () => {
      setContextMenuState({
        top: 12,
        left: 16,
        type: CONTEXT_MENU_TYPE.NODE,
        nodeId: 'file-1',
        isFolder: false,
      })

      render(<TreeContextMenu treeRef={{ current: null }} />)

      fireEvent.click(screen.getByRole('button', { name: 'close' }))

      expect(mocks.setContextMenu).toHaveBeenCalledTimes(1)
      expect(mocks.setContextMenu).toHaveBeenCalledWith(null)
    })
  })
})
