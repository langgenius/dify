import { fireEvent, render, screen } from '@testing-library/react'
import ContrlBtnGroup from '../index'

describe('ContrlBtnGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering fixed action buttons
  describe('Rendering', () => {
    it('should render buttons when rendered', () => {
      // Arrange
      const onSave = vi.fn()
      const onReset = vi.fn()

      // Act
      render(<ContrlBtnGroup onSave={onSave} onReset={onReset} />)

      // Assert
      expect(screen.getByRole('button', { name: 'appDebug.operation.applyConfig' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'appDebug.operation.resetConfig' })).toBeInTheDocument()
    })
  })

  // Handling click interactions
  describe('Interactions', () => {
    it('should invoke callbacks when buttons are clicked', () => {
      // Arrange
      const onSave = vi.fn()
      const onReset = vi.fn()
      render(<ContrlBtnGroup onSave={onSave} onReset={onReset} />)

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'appDebug.operation.applyConfig' }))
      fireEvent.click(screen.getByRole('button', { name: 'appDebug.operation.resetConfig' }))

      // Assert
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onReset).toHaveBeenCalledTimes(1)
    })
  })
})
