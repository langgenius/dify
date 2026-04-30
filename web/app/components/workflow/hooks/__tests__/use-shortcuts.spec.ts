import { act } from '@testing-library/react'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { emitWorkflowCommand, WorkflowCommand } from '../../shortcuts/commands'
import { useWorkflowHotkeys } from '../../shortcuts/use-workflow-hotkeys'

type KeyPressRegistration = {
  keyFilter: unknown
  handler: (event: KeyboardEvent) => void
  options?: {
    events?: string[]
    enabled?: boolean
    ignoreInputs?: boolean
    preventDefault?: boolean
    stopPropagation?: boolean
  }
}

type ReactFlowNodeMock = {
  id: string
  data: {
    _isBundled?: boolean
  }
}

type HotkeyDefinitionMock = {
  hotkey: unknown
  callback: (event: KeyboardEvent) => void
  options?: KeyPressRegistration['options'] & { eventType?: 'keydown' | 'keyup' }
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
const mockHandleModeComment = vi.hoisted(() => vi.fn())
const mockHandleLayout = vi.hoisted(() => vi.fn())
const mockHandleToggleMaximizeCanvas = vi.hoisted(() => vi.fn())
const mockUseKeyHold = vi.hoisted(() => vi.fn(() => false))

vi.mock('@tanstack/react-hotkeys', () => {
  const useHotkeys = (
    definitions: HotkeyDefinitionMock[],
    commonOptions?: KeyPressRegistration['options'],
  ) => {
    definitions.forEach((definition) => {
      keyPressRegistrations.push({
        keyFilter: definition.hotkey,
        handler: definition.callback,
        options: {
          ...commonOptions,
          ...definition.options,
          events: definition.options?.eventType ? [definition.options.eventType] : undefined,
        },
      })
    })
  }

  return {
    useHotkeys,
    useKeyHold: mockUseKeyHold,
  }
})

vi.mock('reactflow', () => ({
  useReactFlow: () => ({
    zoomTo: mockZoomTo,
    getZoom: mockGetZoom,
    fitView: mockFitView,
    getNodes: mockGetNodes,
  }),
}))

vi.mock('../use-nodes-interactions', () => ({
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
}))

vi.mock('../use-edges-interactions', () => ({
  useEdgesInteractions: () => ({
    handleEdgeDelete: mockHandleEdgeDelete,
  }),
}))

vi.mock('../use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    handleSyncWorkflowDraft: mockHandleSyncWorkflowDraft,
  }),
}))

vi.mock('../use-workflow-canvas-maximize', () => ({
  useWorkflowCanvasMaximize: () => ({
    handleToggleMaximizeCanvas: mockHandleToggleMaximizeCanvas,
  }),
}))

vi.mock('../use-workflow-panel-interactions', () => ({
  useWorkflowMoveMode: () => ({
    handleModeHand: mockHandleModeHand,
    handleModePointer: mockHandleModePointer,
    handleModeComment: mockHandleModeComment,
    isCommentModeAvailable: true,
  }),
}))

vi.mock('../use-workflow-organize', () => ({
  useWorkflowOrganize: () => ({
    handleLayout: mockHandleLayout,
  }),
}))

const createKeyboardEvent = (target: HTMLElement = document.body) => ({
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
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

const isEditableTarget = (target: EventTarget | null) => {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

const triggerShortcut = (
  registration: KeyPressRegistration,
  event: KeyboardEvent = createKeyboardEvent(),
) => {
  if (registration.options?.enabled === false)
    return

  if (registration.options?.ignoreInputs !== false && isEditableTarget(event.target))
    return

  if (registration.options?.preventDefault !== false)
    event.preventDefault()

  if (registration.options?.stopPropagation !== false)
    event.stopPropagation()

  registration.handler(event)
}

describe('useShortcuts', () => {
  beforeEach(() => {
    keyPressRegistrations.length = 0
    vi.clearAllMocks()
    mockUseKeyHold.mockReturnValue(false)
    mockGetNodes.mockReturnValue([])
  })

  it('deletes selected nodes and edges only outside editable inputs', () => {
    renderWorkflowHook(() => useWorkflowHotkeys())

    const deleteShortcut = findRegistration(registration => registration.keyFilter === 'Delete')

    const bodyEvent = createKeyboardEvent()
    triggerShortcut(deleteShortcut, bodyEvent)

    expect(bodyEvent.preventDefault).toHaveBeenCalled()
    expect(mockHandleNodesDelete).toHaveBeenCalledTimes(1)
    expect(mockHandleEdgeDelete).toHaveBeenCalledTimes(1)

    const inputEvent = createKeyboardEvent(document.createElement('input'))
    triggerShortcut(deleteShortcut, inputEvent)

    expect(mockHandleNodesDelete).toHaveBeenCalledTimes(1)
    expect(mockHandleEdgeDelete).toHaveBeenCalledTimes(1)
  })

  it('runs layout and zoom shortcuts through the workflow actions', () => {
    renderWorkflowHook(() => useWorkflowHotkeys())

    const layoutShortcut = findRegistration(registration => registration.keyFilter === 'Mod+O')
    const fitViewShortcut = findRegistration(registration => registration.keyFilter === 'Mod+1')
    const halfZoomShortcut = findRegistration(registration => registration.keyFilter === 'Shift+5')
    const zoomOutShortcut = findRegistration(registration => registration.keyFilter === 'Mod+-')
    const zoomInShortcut = findRegistration(registration => registration.keyFilter === 'Mod+=')

    triggerShortcut(layoutShortcut)
    triggerShortcut(fitViewShortcut)
    triggerShortcut(halfZoomShortcut)
    triggerShortcut(zoomOutShortcut)
    triggerShortcut(zoomInShortcut)

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

    renderWorkflowHook(() => useWorkflowHotkeys())

    const copyShortcut = findRegistration(registration => registration.keyFilter === 'Mod+C')
    const event = createKeyboardEvent()
    triggerShortcut(copyShortcut, event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(mockHandleNodesCopy).toHaveBeenCalledTimes(1)

    getSelectionSpy.mockRestore()
  })

  it('dims while shift is held, undims when released, and responds to zen toggle events', () => {
    const { rerender, unmount } = renderWorkflowHook(() => useWorkflowHotkeys())

    mockUseKeyHold.mockReturnValue(true)
    rerender()

    mockUseKeyHold.mockReturnValue(false)
    rerender()

    expect(mockDimOtherNodes).toHaveBeenCalledTimes(1)
    expect(mockUndimAllNodes).toHaveBeenCalledTimes(1)

    act(() => {
      emitWorkflowCommand(WorkflowCommand.ToggleCanvasMaximize)
    })
    expect(mockHandleToggleMaximizeCanvas).toHaveBeenCalledTimes(1)

    unmount()

    act(() => {
      emitWorkflowCommand(WorkflowCommand.ToggleCanvasMaximize)
    })
    expect(mockHandleToggleMaximizeCanvas).toHaveBeenCalledTimes(1)
  })

  it('does not dim when shift is held inside editable inputs', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const { rerender } = renderWorkflowHook(() => useWorkflowHotkeys())

    mockUseKeyHold.mockReturnValue(true)
    rerender()

    expect(mockDimOtherNodes).not.toHaveBeenCalled()
    expect(mockUndimAllNodes).not.toHaveBeenCalled()

    input.remove()
  })
})
