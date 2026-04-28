import { act } from '@testing-library/react'
import { ZEN_TOGGLE_EVENT } from '@/app/components/goto-anything/actions/commands/zen'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { useShortcuts } from '../use-shortcuts'

type KeyPressRegistration = {
  keyFilter: unknown
  handler: (event: KeyboardEvent) => void
  options?: {
    events?: string[]
  }
}

type ReactFlowNodeMock = {
  id: string
  data: {
    _isBundled?: boolean
  }
}

const keyPressRegistrations = vi.hoisted<KeyPressRegistration[]>(() => [])
const mockZoomTo = vi.hoisted(() => vi.fn())
const mockGetZoom = vi.hoisted(() => vi.fn(() => 1))
const mockFitView = vi.hoisted(() => vi.fn())
const mockGetNodes = vi.hoisted(() => vi.fn<() => ReactFlowNodeMock[]>(() => []))
const mockHandleNodesDelete = vi.hoisted(() => vi.fn())
const mockHandleEdgeDelete = vi.hoisted(() => vi.fn())
const mockHandleNodesCopy = vi.hoisted(() => vi.fn())
const mockHandleNodesPaste = vi.hoisted(() => vi.fn())
const mockHandleNodesDuplicate = vi.hoisted(() => vi.fn())
const mockHandleHistoryBack = vi.hoisted(() => vi.fn())
const mockHandleHistoryForward = vi.hoisted(() => vi.fn())
const mockDimOtherNodes = vi.hoisted(() => vi.fn())
const mockUndimAllNodes = vi.hoisted(() => vi.fn())
const mockHandleSyncWorkflowDraft = vi.hoisted(() => vi.fn())
const mockHandleModeHand = vi.hoisted(() => vi.fn())
const mockHandleModePointer = vi.hoisted(() => vi.fn())
const mockHandleLayout = vi.hoisted(() => vi.fn())
const mockHandleToggleMaximizeCanvas = vi.hoisted(() => vi.fn())

vi.mock('ahooks', () => ({
  useKeyPress: (keyFilter: unknown, handler: (event: KeyboardEvent) => void, options?: { events?: string[] }) => {
    keyPressRegistrations.push({ keyFilter, handler, options })
  },
}))

vi.mock('reactflow', () => ({
  useReactFlow: () => ({
    zoomTo: mockZoomTo,
    getZoom: mockGetZoom,
    fitView: mockFitView,
    getNodes: mockGetNodes,
  }),
}))

vi.mock('..', () => ({
  useNodesInteractions: () => ({
    handleNodesCopy: mockHandleNodesCopy,
    handleNodesPaste: mockHandleNodesPaste,
    handleNodesDuplicate: mockHandleNodesDuplicate,
    handleNodesDelete: mockHandleNodesDelete,
    handleHistoryBack: mockHandleHistoryBack,
    handleHistoryForward: mockHandleHistoryForward,
    dimOtherNodes: mockDimOtherNodes,
    undimAllNodes: mockUndimAllNodes,
  }),
  useEdgesInteractions: () => ({
    handleEdgeDelete: mockHandleEdgeDelete,
  }),
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
  useWorkflowCanvasMaximize: () => ({
    handleToggleMaximizeCanvas: mockHandleToggleMaximizeCanvas,
  }),
  useWorkflowMoveMode: () => ({
    handleModeHand: mockHandleModeHand,
    handleModePointer: mockHandleModePointer,
  }),
  useWorkflowOrganize: () => ({
    handleLayout: mockHandleLayout,
  }),
}))

vi.mock('../../workflow-history-store', () => ({
  useWorkflowHistoryStore: () => ({
    shortcutsEnabled: true,
  }),
}))

const createKeyboardEvent = (target: HTMLElement = document.body) => ({
  preventDefault: vi.fn(),
  target,
}) as unknown as KeyboardEvent

const createSelectionMock = (commonAncestorContainer: Node): Selection => ({
  isCollapsed: false,
  rangeCount: 1,
  getRangeAt: () => ({
    commonAncestorContainer,
  } as unknown as Range),
} as unknown as Selection)

const findRegistration = (matcher: (registration: KeyPressRegistration) => boolean) => {
  const registration = keyPressRegistrations.find(matcher)
  expect(registration).toBeDefined()
  return registration as KeyPressRegistration
}

describe('useShortcuts', () => {
  beforeEach(() => {
    keyPressRegistrations.length = 0
    vi.clearAllMocks()
    mockGetNodes.mockReturnValue([])
  })

  it('deletes selected nodes and edges only outside editable inputs', () => {
    renderWorkflowHook(() => useShortcuts())

    const deleteShortcut = findRegistration(registration =>
      Array.isArray(registration.keyFilter)
      && registration.keyFilter.includes('delete'),
    )

    const bodyEvent = createKeyboardEvent()
    deleteShortcut.handler(bodyEvent)

    expect(bodyEvent.preventDefault).toHaveBeenCalled()
    expect(mockHandleNodesDelete).toHaveBeenCalledTimes(1)
    expect(mockHandleEdgeDelete).toHaveBeenCalledTimes(1)

    const inputEvent = createKeyboardEvent(document.createElement('input'))
    deleteShortcut.handler(inputEvent)

    expect(mockHandleNodesDelete).toHaveBeenCalledTimes(1)
    expect(mockHandleEdgeDelete).toHaveBeenCalledTimes(1)
  })

  it('runs layout and zoom shortcuts through the workflow actions', () => {
    renderWorkflowHook(() => useShortcuts())

    const layoutShortcut = findRegistration(registration => registration.keyFilter === 'ctrl.o' || registration.keyFilter === 'meta.o')
    const fitViewShortcut = findRegistration(registration => registration.keyFilter === 'ctrl.1' || registration.keyFilter === 'meta.1')
    const halfZoomShortcut = findRegistration(registration => registration.keyFilter === 'shift.5')
    const zoomOutShortcut = findRegistration(registration => registration.keyFilter === 'ctrl.dash' || registration.keyFilter === 'meta.dash')
    const zoomInShortcut = findRegistration(registration => registration.keyFilter === 'ctrl.equalsign' || registration.keyFilter === 'meta.equalsign')

    layoutShortcut.handler(createKeyboardEvent())
    fitViewShortcut.handler(createKeyboardEvent())
    halfZoomShortcut.handler(createKeyboardEvent())
    zoomOutShortcut.handler(createKeyboardEvent())
    zoomInShortcut.handler(createKeyboardEvent())

    expect(mockHandleLayout).toHaveBeenCalledTimes(1)
    expect(mockFitView).toHaveBeenCalledTimes(1)
    expect(mockZoomTo).toHaveBeenNthCalledWith(1, 0.5)
    expect(mockZoomTo).toHaveBeenNthCalledWith(2, 0.9)
    expect(mockZoomTo).toHaveBeenNthCalledWith(3, 1.1)
    expect(mockHandleSyncWorkflowDraft).toHaveBeenCalledTimes(4)
  })

  it('copies bundled nodes even when an incidental text selection exists outside the workflow canvas', () => {
    const getSelectionSpy = vi.spyOn(document, 'getSelection')
    const textContainer = document.createElement('div')
    const selectedText = document.createElement('span')
    selectedText.textContent = 'Selected browser text'
    textContainer.appendChild(selectedText)

    getSelectionSpy.mockReturnValue(createSelectionMock(selectedText))
    mockGetNodes.mockReturnValue([
      {
        id: 'bundled-node',
        data: {
          _isBundled: true,
        },
      },
    ])

    renderWorkflowHook(() => useShortcuts())

    const copyShortcut = findRegistration(registration => registration.keyFilter === 'ctrl.c' || registration.keyFilter === 'meta.c')
    const event = createKeyboardEvent()
    copyShortcut.handler(event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(mockHandleNodesCopy).toHaveBeenCalledTimes(1)

    getSelectionSpy.mockRestore()
  })

  it('dims on shift down, undims on shift up, and responds to zen toggle events', () => {
    const { unmount } = renderWorkflowHook(() => useShortcuts())

    const shiftDownShortcut = findRegistration(registration => registration.keyFilter === 'shift' && registration.options?.events?.[0] === 'keydown')
    const shiftUpShortcut = findRegistration(registration => typeof registration.keyFilter === 'function' && registration.options?.events?.[0] === 'keyup')

    shiftDownShortcut.handler(createKeyboardEvent())
    shiftUpShortcut.handler({ ...createKeyboardEvent(), key: 'Shift' } as KeyboardEvent)

    expect(mockDimOtherNodes).toHaveBeenCalledTimes(1)
    expect(mockUndimAllNodes).toHaveBeenCalledTimes(1)

    act(() => {
      window.dispatchEvent(new Event(ZEN_TOGGLE_EVENT))
    })
    expect(mockHandleToggleMaximizeCanvas).toHaveBeenCalledTimes(1)

    unmount()

    act(() => {
      window.dispatchEvent(new Event(ZEN_TOGGLE_EVENT))
    })
    expect(mockHandleToggleMaximizeCanvas).toHaveBeenCalledTimes(1)
  })
})
