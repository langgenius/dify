import type { LexicalComposerContextWithEditor } from '@lexical/react/LexicalComposerContext'
import type { LexicalEditor } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { $insertNodes, FOCUS_COMMAND } from 'lexical'
import Placeholder from '../placeholder'

const mockEditorUpdate = vi.fn((callback: () => void) => callback())
const mockDispatchCommand = vi.fn()
const mockInsertNodes = vi.fn()
const mockTextNode = vi.fn()

const mockEditor = {
  update: mockEditorUpdate,
  dispatchCommand: mockDispatchCommand,
} as unknown as LexicalEditor

const lexicalContextValue: LexicalComposerContextWithEditor = [
  mockEditor,
  { getTheme: () => undefined },
]

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: vi.fn(),
}))

vi.mock('lexical', () => ({
  $insertNodes: vi.fn(),
  FOCUS_COMMAND: 'focus-command',
}))

vi.mock('@/app/components/base/prompt-editor/plugins/custom-text/node', () => ({
  CustomTextNode: class MockCustomTextNode {
    value: string

    constructor(value: string) {
      this.value = value
      mockTextNode(value)
    }
  },
}))

describe('Mixed variable placeholder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useLexicalComposerContext).mockReturnValue(lexicalContextValue)
    vi.mocked($insertNodes).mockImplementation(nodes => mockInsertNodes(nodes))
  })

  it('should insert an empty text node and focus the editor when the placeholder background is clicked', () => {
    const parentClick = vi.fn()

    render(
      <div onClick={parentClick}>
        <Placeholder />
      </div>,
    )

    fireEvent.click(screen.getByText('workflow.nodes.tool.insertPlaceholder1'))

    expect(parentClick).not.toHaveBeenCalled()
    expect(mockTextNode).toHaveBeenCalledWith('')
    expect(mockInsertNodes).toHaveBeenCalledTimes(1)
    expect(mockDispatchCommand).toHaveBeenCalledWith(FOCUS_COMMAND, undefined)
  })

  it('should insert a slash shortcut from the highlighted action and prevent the native mouse down behavior', () => {
    render(<Placeholder />)

    const shortcut = screen.getByText('workflow.nodes.tool.insertPlaceholder2')
    const event = createEvent.mouseDown(shortcut)
    fireEvent(shortcut, event)

    expect(event.defaultPrevented).toBe(true)
    expect(mockTextNode).toHaveBeenCalledWith('/')
    expect(mockDispatchCommand).toHaveBeenCalledWith(FOCUS_COMMAND, undefined)
  })
})
