import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { VariableLabelInEditor, VariableLabelInSelect, VariableLabelInText } from '../index'

describe('variable-label index', () => {
  describe('Rendering', () => {
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

    it('discloses the variable validation error on hover', async () => {
      const user = userEvent.setup()
      render(
        <VariableLabelInEditor
          nodeType={BlockEnum.Code}
          nodeTitle="Source Node"
          variables={['source-node', 'payload']}
          isSelected
          errorMsg="Invalid variable"
          rightSlot={<span>suffix</span>}
        />,
      )

      expect(screen.getByText('suffix')).toBeInTheDocument()

      await user.hover(screen.getByText('payload'))

      expect(await screen.findByText('Invalid variable')).toBeVisible()
    })
  })
})
