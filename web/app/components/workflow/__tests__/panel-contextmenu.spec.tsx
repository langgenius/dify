import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import PanelContextmenu from '../panel-contextmenu'

const mockUseClickAway = vi.hoisted(() => vi.fn())
const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseStore = vi.hoisted(() => vi.fn())
const mockUseNodesInteractions = vi.hoisted(() => vi.fn())
const mockUsePanelInteractions = vi.hoisted(() => vi.fn())
const mockUseWorkflowStartRun = vi.hoisted(() => vi.fn())
const mockUseWorkflowMoveMode = vi.hoisted(() => vi.fn())
const mockUseOperator = vi.hoisted(() => vi.fn())
const mockUseDSL = vi.hoisted(() => vi.fn())

vi.mock('ahooks', () => ({
  useClickAway: (...args: unknown[]) => mockUseClickAway(...args),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: {
    panelMenu?: { left: number, top: number }
    clipboardElements: unknown[]
    pendingComment: null | { pageX: number, pageY: number, elementX: number, elementY: number }
    setCommentPlacing: (placing: boolean) => void
    setCommentQuickAdd: (quickAdd: boolean) => void
    setShowImportDSLModal: (visible: boolean) => void
  }) => unknown) => mockUseStore(selector),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesInteractions: () => mockUseNodesInteractions(),
  usePanelInteractions: () => mockUsePanelInteractions(),
  useWorkflowStartRun: () => mockUseWorkflowStartRun(),
  useWorkflowMoveMode: () => mockUseWorkflowMoveMode(),
  useDSL: () => mockUseDSL(),
}))

vi.mock('@/app/components/workflow/operator/hooks', () => ({
  useOperator: () => mockUseOperator(),
}))

vi.mock('@/app/components/workflow/operator/add-block', () => ({
  __esModule: true,
  default: ({ renderTrigger }: { renderTrigger: () => ReactNode }) => (
    <div data-testid="add-block">{renderTrigger()}</div>
  ),
}))

vi.mock('@/app/components/base/divider', () => ({
  __esModule: true,
  default: ({ className }: { className?: string }) => <div data-testid="divider" className={className} />,
}))

vi.mock('@/app/components/workflow/shortcuts-name', () => ({
  __esModule: true,
  default: ({ keys }: { keys: string[] }) => <span data-testid={`shortcut-${keys.join('-')}`}>{keys.join('+')}</span>,
}))

describe('PanelContextmenu', () => {
  const mockHandleNodesPaste = vi.fn()
  const mockHandlePaneContextmenuCancel = vi.fn()
  const mockHandleStartWorkflowRun = vi.fn()
  const mockHandleAddNote = vi.fn()
  const mockExportCheck = vi.fn()
  const mockSetShowImportDSLModal = vi.fn()
  const mockSetCommentPlacing = vi.fn()
  const mockSetCommentQuickAdd = vi.fn()
  let panelMenu: { left: number, top: number } | undefined
  let clipboardElements: unknown[]
  let pendingComment: null | { pageX: number, pageY: number, elementX: number, elementY: number }
  let clickAwayHandler: (() => void) | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    panelMenu = undefined
    clipboardElements = []
    pendingComment = null
    clickAwayHandler = undefined

    mockUseClickAway.mockImplementation((handler: () => void) => {
      clickAwayHandler = handler
    })
    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })
    mockUseStore.mockImplementation((selector: (state: {
      panelMenu?: { left: number, top: number }
      clipboardElements: unknown[]
      pendingComment: null | { pageX: number, pageY: number, elementX: number, elementY: number }
      setCommentPlacing: (placing: boolean) => void
      setCommentQuickAdd: (quickAdd: boolean) => void
      setShowImportDSLModal: (visible: boolean) => void
    }) => unknown) => selector({
      panelMenu,
      clipboardElements,
      pendingComment,
      setCommentPlacing: mockSetCommentPlacing,
      setCommentQuickAdd: mockSetCommentQuickAdd,
      setShowImportDSLModal: mockSetShowImportDSLModal,
    }))
    mockUseNodesInteractions.mockReturnValue({
      handleNodesPaste: mockHandleNodesPaste,
    })
    mockUsePanelInteractions.mockReturnValue({
      handlePaneContextmenuCancel: mockHandlePaneContextmenuCancel,
    })
    mockUseWorkflowStartRun.mockReturnValue({
      handleStartWorkflowRun: mockHandleStartWorkflowRun,
    })
    mockUseWorkflowMoveMode.mockReturnValue({
      isCommentModeAvailable: false,
    })
    mockUseOperator.mockReturnValue({
      handleAddNote: mockHandleAddNote,
    })
    mockUseDSL.mockReturnValue({
      exportCheck: mockExportCheck,
    })
  })

  it('should stay hidden when the panel menu is absent', () => {
    render(<PanelContextmenu />)

    expect(screen.queryByTestId('add-block')).not.toBeInTheDocument()
  })

  it('should keep paste disabled when the clipboard is empty', () => {
    panelMenu = { left: 24, top: 48 }

    render(<PanelContextmenu />)

    fireEvent.click(screen.getByText('common.pasteHere'))

    expect(mockHandleNodesPaste).not.toHaveBeenCalled()
    expect(mockHandlePaneContextmenuCancel).not.toHaveBeenCalled()
  })

  it('should render actions, position the menu, and execute each action', () => {
    panelMenu = { left: 24, top: 48 }
    clipboardElements = [{ id: 'copied-node' }]
    const { container } = render(<PanelContextmenu />)

    expect(screen.getByTestId('add-block')).toHaveTextContent('common.addBlock')
    expect(screen.getByRole('button', { name: /common\.run/i })).toHaveTextContent(/Alt\s*R/)
    expect(screen.getByRole('button', { name: /common\.pasteHere/i })).toHaveTextContent(/Ctrl\s*V/)
    expect(container.firstChild).toHaveStyle({
      left: '24px',
      top: '48px',
    })

    fireEvent.click(screen.getByText('nodes.note.addNote'))
    fireEvent.click(screen.getByText('common.run'))
    fireEvent.click(screen.getByText('common.pasteHere'))
    fireEvent.click(screen.getByText('export'))
    fireEvent.click(screen.getByText('importApp'))
    clickAwayHandler?.()

    expect(mockHandleAddNote).toHaveBeenCalledTimes(1)
    expect(mockHandleStartWorkflowRun).toHaveBeenCalledTimes(1)
    expect(mockHandleNodesPaste).toHaveBeenCalledTimes(1)
    expect(mockExportCheck).toHaveBeenCalledTimes(1)
    expect(mockSetShowImportDSLModal).toHaveBeenCalledWith(true)
    expect(mockHandlePaneContextmenuCancel).toHaveBeenCalledTimes(4)
  })
})
