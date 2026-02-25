import type { LexicalComposerContextWithEditor } from '@lexical/react/LexicalComposerContext'
import type { LexicalEditor } from 'lexical'
import type { ReactElement } from 'react'
import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSelectOrDelete } from '../../hooks'
import ErrorMessageBlockComponent from './component'
import { DELETE_ERROR_MESSAGE_COMMAND, ErrorMessageBlockNode } from './index'

vi.mock('../../hooks')

const mockHasNodes = vi.fn()

const mockEditor = {
  hasNodes: mockHasNodes,
} as unknown as LexicalEditor

const lexicalContextValue: LexicalComposerContextWithEditor = [
  mockEditor,
  { getTheme: () => undefined },
]

const renderWithLexicalContext = (ui: ReactElement) => {
  return render(
    <LexicalComposerContext.Provider value={lexicalContextValue}>
      {ui}
    </LexicalComposerContext.Provider>,
  )
}

describe('ErrorMessageBlockComponent', () => {
  const mockRef = { current: null as HTMLDivElement | null }

  beforeEach(() => {
    vi.clearAllMocks()
    mockHasNodes.mockReturnValue(true)
    vi.mocked(useSelectOrDelete).mockReturnValue([mockRef, false])
  })

  describe('Rendering', () => {
    it('should render error_message text and base styles when unselected', () => {
      const { container } = renderWithLexicalContext(<ErrorMessageBlockComponent nodeKey="node-1" />)

      expect(screen.getByText('error_message')).toBeInTheDocument()
      expect(container.querySelector('svg')).toBeInTheDocument()
      expect(container.firstChild).toHaveClass('border-components-panel-border-subtle')
    })

    it('should render selected styles when node is selected', () => {
      vi.mocked(useSelectOrDelete).mockReturnValue([mockRef, true])

      const { container } = renderWithLexicalContext(<ErrorMessageBlockComponent nodeKey="node-1" />)

      expect(container.firstChild).toHaveClass('border-state-accent-solid')
      expect(container.firstChild).toHaveClass('bg-state-accent-hover')
    })
  })

  describe('Interactions', () => {
    it('should stop propagation when wrapper is clicked', async () => {
      const user = userEvent.setup()
      const onParentClick = vi.fn()

      render(
        <LexicalComposerContext.Provider value={lexicalContextValue}>
          <div onClick={onParentClick}>
            <ErrorMessageBlockComponent nodeKey="node-1" />
          </div>
        </LexicalComposerContext.Provider>,
      )

      await user.click(screen.getByText('error_message'))

      expect(onParentClick).not.toHaveBeenCalled()
    })
  })

  describe('Hooks', () => {
    it('should use selection hook and check node registration on mount', () => {
      renderWithLexicalContext(<ErrorMessageBlockComponent nodeKey="node-xyz" />)

      expect(useSelectOrDelete).toHaveBeenCalledWith('node-xyz', DELETE_ERROR_MESSAGE_COMMAND)
      expect(mockHasNodes).toHaveBeenCalledWith([ErrorMessageBlockNode])
    })

    it('should throw when ErrorMessageBlockNode is not registered', () => {
      mockHasNodes.mockReturnValue(false)

      expect(() => renderWithLexicalContext(<ErrorMessageBlockComponent nodeKey="node-1" />)).toThrow(
        'WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor',
      )
    })
  })
})
