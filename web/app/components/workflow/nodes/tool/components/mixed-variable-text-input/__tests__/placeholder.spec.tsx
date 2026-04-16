import { fireEvent, render, screen } from '@testing-library/react'
import Placeholder from '../placeholder'

const mockUpdate = vi.fn<(callback: () => void) => void>()
const mockDispatchCommand = vi.fn()
const mockInsertNodes = vi.fn()

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [{
    update: mockUpdate,
    dispatchCommand: mockDispatchCommand,
  }],
}))

vi.mock('lexical', () => ({
  $insertNodes: (...args: unknown[]) => mockInsertNodes(...args),
  FOCUS_COMMAND: 'FOCUS_COMMAND',
}))

vi.mock('@/app/components/base/prompt-editor/plugins/custom-text/node', () => ({
  CustomTextNode: class {
    text: string

    constructor(text: string) {
      this.text = text
    }
  },
}))

describe('tool/mixed-variable-text-input/placeholder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdate.mockImplementation(callback => callback())
  })

  it('should insert text and focus the editor for click and slash actions', () => {
    render(<Placeholder />)

    const root = screen.getByText('workflow.nodes.tool.insertPlaceholder1').closest('.cursor-text') as HTMLElement

    expect(screen.getByText('workflow.nodes.tool.insertPlaceholder1'))!.toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.tool.insertPlaceholder2'))!.toBeInTheDocument()
    expect(screen.getByText('String'))!.toBeInTheDocument()

    fireEvent.click(root)
    expect(mockInsertNodes.mock.calls[0]![0][0]).toMatchObject({ text: '' })
    expect(mockDispatchCommand).toHaveBeenCalledWith('FOCUS_COMMAND', undefined)

    fireEvent.mouseDown(screen.getByText('workflow.nodes.tool.insertPlaceholder2'))
    expect(mockInsertNodes.mock.calls[1]![0][0]).toMatchObject({ text: '/' })
    expect(mockDispatchCommand).toHaveBeenNthCalledWith(2, 'FOCUS_COMMAND', undefined)
  })

  it('should hide variable insertion affordance and badge when disabled', () => {
    const { container } = render(
      <Placeholder
        disableVariableInsertion
        hideBadge
      />,
    )

    expect(screen.getByText('workflow.nodes.tool.insertPlaceholder1'))!.toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.tool.insertPlaceholder2')).not.toBeInTheDocument()
    expect(screen.queryByText('String')).not.toBeInTheDocument()
    expect(container.firstChild)!.toHaveClass('items-start')
    expect(container.firstChild)!.toHaveClass('py-1')
  })
})
