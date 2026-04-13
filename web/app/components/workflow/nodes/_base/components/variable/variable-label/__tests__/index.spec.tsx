import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import VariableIcon from '../base/variable-icon'
import VariableLabel from '../base/variable-label'
import VariableName from '../base/variable-name'
import VariableNodeLabel from '../base/variable-node-label'
import { VariableIconWithColor, VariableLabelInEditor, VariableLabelInNode, VariableLabelInSelect, VariableLabelInText } from '../index'

describe('variable-label index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The barrel exports should render the node and text variants with the expected variable metadata.
  describe('Rendering', () => {
    it('should render the node variant with node label and variable type', () => {
      render(
        <VariableLabelInNode
          nodeType={BlockEnum.Code}
          nodeTitle="Source Node"
          variables={['source-node', 'answer']}
          variableType={VarType.string}
        />,
      )

      expect(screen.getByText('Source Node')).toBeInTheDocument()
      expect(screen.getByText('answer')).toBeInTheDocument()
      expect(screen.getByText('String')).toBeInTheDocument()
    })

    it('should render the text variant with the shortened variable path', () => {
      render(
        <VariableLabelInText
          nodeType={BlockEnum.Code}
          nodeTitle="Source Node"
          variables={['source-node', 'payload', 'answer']}
          notShowFullPath
          isExceptionVariable
        />,
      )

      expect(screen.getByTestId('exception-variable')).toBeInTheDocument()
      expect(screen.getByText('Source Node')).toBeInTheDocument()
      expect(screen.getByText('answer')).toBeInTheDocument()
    })

    it('should render the select variant with the full variable path', () => {
      render(
        <VariableLabelInSelect
          nodeType={BlockEnum.Code}
          nodeTitle="Source Node"
          variables={['source-node', 'payload', 'answer']}
        />,
      )

      expect(screen.getByText('payload.answer')).toBeInTheDocument()
    })

    it('should render the editor variant with selected styles and inline error feedback', async () => {
      const user = userEvent.setup()
      const { container } = render(
        <VariableLabelInEditor
          nodeType={BlockEnum.Code}
          nodeTitle="Source Node"
          variables={['source-node', 'payload']}
          isSelected
          errorMsg="Invalid variable"
          rightSlot={<span>suffix</span>}
        />,
      )

      const badge = screen.getByText('payload').closest('div')
      expect(badge).toBeInTheDocument()
      expect(screen.getByText('suffix')).toBeInTheDocument()

      await user.hover(screen.getByText('payload'))

      expect(container.querySelector('[data-icon="Warning"]')).not.toBeNull()
    })

    it('should render the icon helpers for environment and exception variables', () => {
      const { container } = render(
        <div>
          <VariableIcon variables={['env', 'API_KEY']} />
          <VariableIconWithColor
            variables={['conversation', 'message']}
            isExceptionVariable
          />
        </div>,
      )

      expect(container.querySelectorAll('svg').length).toBeGreaterThan(0)
    })

    it('should render the base variable name with shortened path and title', () => {
      render(
        <VariableName
          variables={['node-id', 'payload', 'answer']}
          notShowFullPath
        />,
      )

      expect(screen.getByText('answer')).toHaveAttribute('title', 'answer')
    })

    it('should render the base node label only when node type exists', () => {
      const { container, rerender } = render(<VariableNodeLabel />)

      expect(container).toBeEmptyDOMElement()

      rerender(
        <VariableNodeLabel
          nodeType={BlockEnum.Code}
          nodeTitle="Code Node"
        />,
      )

      expect(screen.getByText('Code Node')).toBeInTheDocument()
    })

    it('should render the base label with variable type and right slot', () => {
      render(
        <VariableLabel
          nodeType={BlockEnum.Code}
          nodeTitle="Source Node"
          variables={['sys', 'query']}
          variableType={VarType.string}
          rightSlot={<span>slot</span>}
        />,
      )

      expect(screen.getByText('Source Node')).toBeInTheDocument()
      expect(screen.getByText('query')).toBeInTheDocument()
      expect(screen.getByText('String')).toBeInTheDocument()
      expect(screen.getByText('slot')).toBeInTheDocument()
    })
  })
})
