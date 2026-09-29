import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createPortal } from 'react-dom'
import { ReactFlowProvider } from 'reactflow'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { WorkflowCanvas } from '../workflow-canvas'

const actions = vi.hoisted(() => ({
  nodesReadOnly: false,
  copy: vi.fn(),
  paste: vi.fn(),
  duplicate: vi.fn(),
  deleteNodes: vi.fn(),
  deleteEdge: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  save: vi.fn(),
  organize: vi.fn(),
  hand: vi.fn(),
  pointer: vi.fn(),
  comment: vi.fn(),
  dim: vi.fn(),
  undim: vi.fn(),
  zoomTo: vi.fn(),
  fitView: vi.fn(),
  getZoom: vi.fn(() => 1),
  getNodes: vi.fn<() => { data: { _isBundled?: boolean } }[]>(() => []),
}))

vi.mock('reactflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('reactflow')>()),
  useReactFlow: () => ({
    zoomTo: actions.zoomTo,
    fitView: actions.fitView,
    getZoom: actions.getZoom,
    getNodes: actions.getNodes,
  }),
}))
vi.mock('../../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({
    handleNodesCopy: actions.copy,
    handleNodesPaste: actions.paste,
    handleNodesDuplicate: actions.duplicate,
    handleNodesDelete: actions.deleteNodes,
    handleHistoryBack: actions.undo,
    handleHistoryForward: actions.redo,
    dimOtherNodes: actions.dim,
    undimAllNodes: actions.undim,
  }),
}))
vi.mock('../../hooks/use-edges-interactions', () => ({
  useEdgesInteractions: () => ({ handleEdgeDelete: actions.deleteEdge }),
}))
vi.mock('../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ handleSyncWorkflowDraft: actions.save }),
}))
vi.mock('../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: actions.nodesReadOnly }),
}))
vi.mock('../../hooks/use-workflow-organize', () => ({
  useWorkflowOrganize: () => ({ handleLayout: actions.organize }),
}))
vi.mock('../../hooks/use-workflow-panel-interactions', () => ({
  useWorkflowMoveMode: () => ({
    handleModeHand: actions.hand,
    handleModePointer: actions.pointer,
    handleModeComment: actions.comment,
    canUseCommentMode: true,
  }),
}))

function Canvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas nodes={[]} edges={[]}>
        <input aria-label="Node name" />
        <textarea aria-label="Node prompt" />
        <div contentEditable suppressContentEditableWarning role="textbox" aria-label="Note">
          <span>Note content</span>
        </div>
        <button onKeyDown={(event) => event.preventDefault()}>Handled by a local widget</button>
        {createPortal(<button>Popup action</button>, document.body)}
      </WorkflowCanvas>
      <button>Outside canvas</button>
    </ReactFlowProvider>
  )
}

function renderCanvas(platform: 'mac' | 'windows' = 'windows') {
  return renderWorkflowComponent(
    <HotkeysProvider defaultOptions={{ hotkey: { platform } }}>
      <Canvas />
    </HotkeysProvider>,
  )
}

function focusCanvas() {
  const canvas = screen.getByLabelText('app.types.workflow')
  act(() => canvas.focus())
  return canvas
}

describe('Workflow canvas commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.nodesReadOnly = false
    actions.getNodes.mockReturnValue([])
    actions.getZoom.mockReturnValue(1)
  })

  it.each(['mac', 'windows'] as const)(
    'runs graph actions only from its canvas on %s',
    async (platform) => {
      const user = userEvent.setup()
      renderCanvas(platform)
      const mod = platform === 'mac' ? 'Meta' : 'Control'
      focusCanvas()
      await user.keyboard(`{${mod}>}cvszy{/${mod}}{Delete}`)
      expect(actions.copy).toHaveBeenCalledTimes(1)
      expect(actions.paste).toHaveBeenCalledTimes(1)
      expect(actions.save).toHaveBeenCalledTimes(1)
      expect(actions.undo).toHaveBeenCalledTimes(1)
      expect(actions.redo).toHaveBeenCalledTimes(1)
      expect(actions.deleteNodes).toHaveBeenCalledTimes(1)
      expect(actions.deleteEdge).toHaveBeenCalledTimes(1)

      await user.click(screen.getByRole('button', { name: 'Popup action' }))
      await user.keyboard(`{${mod}>}cvszy{/${mod}}{Delete}`)
      await user.click(screen.getByRole('button', { name: 'Outside canvas' }))
      await user.keyboard(`{${mod}>}cvszy{/${mod}}{Delete}`)
      expect(actions.copy).toHaveBeenCalledTimes(1)
      expect(actions.save).toHaveBeenCalledTimes(1)
      expect(actions.undo).toHaveBeenCalledTimes(1)
      expect(actions.deleteNodes).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['Node name', 'Node prompt', 'Note', 'Note content'])(
    'leaves editor keys and native defaults to %s',
    (name) => {
      renderCanvas()
      const editor =
        name === 'Note content' ? screen.getByText(name) : screen.getByRole('textbox', { name })
      for (const key of ['s', 'z', 'c', 'v']) {
        const event = new KeyboardEvent('keydown', {
          key,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        fireEvent(editor, event)
        fireEvent.keyUp(editor, { key, ctrlKey: true })
        expect(event.defaultPrevented).toBe(false)
      }
      const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
      fireEvent(editor, event)
      expect(event.defaultPrevented).toBe(false)
      expect(actions.save).not.toHaveBeenCalled()
      expect(actions.undo).not.toHaveBeenCalled()
      expect(actions.copy).not.toHaveBeenCalled()
      expect(actions.paste).not.toHaveBeenCalled()
      expect(actions.deleteNodes).not.toHaveBeenCalled()
    },
  )

  it('ignores a claimed event, composition, and repeats until the key is released', async () => {
    const user = userEvent.setup()
    renderCanvas()
    await user.click(screen.getByRole('button', { name: 'Handled by a local widget' }))
    await user.keyboard('{Control>}s{/Control}')
    expect(actions.save).not.toHaveBeenCalled()

    const canvas = focusCanvas()
    fireEvent.keyDown(canvas, { key: 's', ctrlKey: true, isComposing: true })
    fireEvent.keyUp(canvas, { key: 's', ctrlKey: true })
    expect(actions.save).not.toHaveBeenCalled()
    const composingDelete = new KeyboardEvent('keydown', {
      key: 'Delete',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(canvas, composingDelete)
    fireEvent.keyUp(canvas, { key: 'Delete' })
    expect(composingDelete.defaultPrevented).toBe(false)
    expect(actions.deleteNodes).not.toHaveBeenCalled()
    await user.keyboard('{Control>}{s>3/}{/Control}')
    expect(actions.save).toHaveBeenCalledTimes(1)
    await user.keyboard('{Control>}s{/Control}')
    expect(actions.save).toHaveBeenCalledTimes(2)
  })

  it('consumes every owned repeat while performing discrete actions only once', () => {
    renderCanvas()
    const canvas = focusCanvas()
    for (const key of ['s', 'd', 'o', 'c']) {
      for (const repeat of [false, true, true]) {
        const event = new KeyboardEvent('keydown', {
          key,
          ctrlKey: true,
          repeat,
          bubbles: true,
          cancelable: true,
        })
        fireEvent(canvas, event)
        expect(event.defaultPrevented).toBe(true)
      }
      fireEvent.keyUp(canvas, { key, ctrlKey: true })
    }
    expect(actions.save).toHaveBeenCalledTimes(1)
    expect(actions.duplicate).toHaveBeenCalledTimes(1)
    expect(actions.organize).toHaveBeenCalledTimes(1)
    expect(actions.copy).toHaveBeenCalledTimes(1)
  })

  it('does not consume unavailable editing commands while still allowing viewport zoom', async () => {
    const user = userEvent.setup()
    actions.nodesReadOnly = true
    renderCanvas()
    const canvas = focusCanvas()
    for (const key of ['s', 'd', 'o', 'z']) {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      fireEvent(canvas, event)
      fireEvent.keyUp(canvas, { key, ctrlKey: true })
      expect(event.defaultPrevented).toBe(false)
    }
    const deletion = new KeyboardEvent('keydown', {
      key: 'Delete',
      bubbles: true,
      cancelable: true,
    })
    fireEvent(canvas, deletion)
    expect(deletion.defaultPrevented).toBe(false)
    expect(actions.save).not.toHaveBeenCalled()
    expect(actions.deleteNodes).not.toHaveBeenCalled()
    expect(actions.duplicate).not.toHaveBeenCalled()
    expect(actions.organize).not.toHaveBeenCalled()
    expect(actions.undo).not.toHaveBeenCalled()
    await user.keyboard('{Control>}{=>3/}{/Control}')
    expect(actions.zoomTo).toHaveBeenCalledTimes(3)
  })

  it('keeps graph history disabled while debug preview is open', async () => {
    const user = userEvent.setup()
    const { store } = renderCanvas()
    focusCanvas()
    act(() => store.setState({ showDebugAndPreviewPanel: true }))
    await user.keyboard('{Control>}zy{/Control}')
    expect(actions.undo).not.toHaveBeenCalled()
    expect(actions.redo).not.toHaveBeenCalled()
    act(() => store.setState({ showDebugAndPreviewPanel: false }))
    await user.keyboard('{Control>}zy{/Control}')
    expect(actions.undo).toHaveBeenCalledTimes(1)
    expect(actions.redo).toHaveBeenCalledTimes(1)
  })

  it('keeps layout and zoom bound to the canvas and saves the viewport', async () => {
    const user = userEvent.setup()
    renderCanvas()
    focusCanvas()
    await user.keyboard('{Control>}o1-={/Control}{Shift>}5{/Shift}')
    expect(actions.organize).toHaveBeenCalledTimes(1)
    expect(actions.fitView).toHaveBeenCalledTimes(1)
    expect(actions.zoomTo).toHaveBeenNthCalledWith(1, 0.9)
    expect(actions.zoomTo).toHaveBeenNthCalledWith(2, 1.1)
    expect(actions.zoomTo).toHaveBeenNthCalledWith(3, 0.5)
    expect(actions.save).toHaveBeenCalledTimes(4)
  })

  it('dims only while Shift is held with canvas focus and clears on focus loss', async () => {
    const user = userEvent.setup()
    renderCanvas()
    focusCanvas()
    await user.keyboard('{Shift>}')
    expect(actions.dim).toHaveBeenCalledTimes(1)
    act(() => screen.getByRole('textbox', { name: 'Node prompt' }).focus())
    expect(actions.undim).toHaveBeenCalledTimes(1)
    await user.keyboard('{/Shift}{Shift>}{/Shift}')
    expect(actions.dim).toHaveBeenCalledTimes(1)
  })

  it('preserves text selection copying unless bundled nodes are selected', async () => {
    const user = userEvent.setup()
    renderCanvas()
    const canvas = focusCanvas()
    const selection = document.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('Note content'))
    selection.addRange(range)
    await user.keyboard('{Control>}c{/Control}')
    expect(actions.copy).not.toHaveBeenCalled()
    actions.getNodes.mockReturnValue([{ data: { _isBundled: true } }])
    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(canvas, event)
    fireEvent.keyUp(canvas, { key: 'c', ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(actions.copy).toHaveBeenCalledTimes(1)
    selection.removeAllRanges()
  })
})
