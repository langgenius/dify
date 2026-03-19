import { render, screen } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { VariableLabelInNode, VariableLabelInText } from '../index'

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
  })
})
