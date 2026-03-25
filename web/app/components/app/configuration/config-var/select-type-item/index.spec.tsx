import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { InputVarType } from '@/app/components/workflow/types'
import SelectTypeItem from './index'

describe('SelectTypeItem', () => {
  // Rendering pathways based on type and selection state
  describe('Rendering', () => {
    it('should render ok', () => {
      // Arrange
      const { container } = render(
        <SelectTypeItem
          type={InputVarType.textInput}
          selected={false}
          onClick={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('appDebug.variableConfig.text-input')).toBeInTheDocument()
      expect(container.querySelector('svg')).not.toBeNull()
    })
  })

  // User interaction outcomes
  describe('Interactions', () => {
    it('should trigger onClick when item is pressed', () => {
      const handleClick = vi.fn()
      // Arrange
      render(
        <SelectTypeItem
          type={InputVarType.paragraph}
          selected={false}
          onClick={handleClick}
        />,
      )

      // Act
      fireEvent.click(screen.getByText('appDebug.variableConfig.paragraph'))

      // Assert
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })
})
