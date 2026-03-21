import { fireEvent, render, screen } from '@testing-library/react'
import OperationBtn from './index'

vi.mock('@remixicon/react', () => ({
  RiAddLine: (props: { className?: string }) => (
    <svg data-testid="add-icon" className={props.className} />
  ),
  RiEditLine: (props: { className?: string }) => (
    <svg data-testid="edit-icon" className={props.className} />
  ),
}))

describe('OperationBtn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering icons and translation labels
  describe('Rendering', () => {
    it('should render passed custom class when provided', () => {
      // Arrange
      const customClass = 'custom-class'

      // Act
      render(<OperationBtn type="add" className={customClass} />)

      // Assert
      expect(screen.getByText('common.operation.add').parentElement).toHaveClass(customClass)
    })
    it('should render add icon when type is add', () => {
      // Arrange
      const onClick = vi.fn()

      // Act
      render(<OperationBtn type="add" onClick={onClick} className="custom-class" />)

      // Assert
      expect(screen.getByTestId('add-icon')).toBeInTheDocument()
      expect(screen.getByText('common.operation.add')).toBeInTheDocument()
    })

    it('should render edit icon when provided', () => {
      // Arrange
      const actionName = 'Rename'

      // Act
      render(<OperationBtn type="edit" actionName={actionName} />)

      // Assert
      expect(screen.getByTestId('edit-icon')).toBeInTheDocument()
      expect(screen.queryByTestId('add-icon')).toBeNull()
      expect(screen.getByText(actionName)).toBeInTheDocument()
    })
  })

  // Click handling
  describe('Interactions', () => {
    it('should execute click handler when button is clicked', () => {
      // Arrange
      const onClick = vi.fn()
      render(<OperationBtn type="add" onClick={onClick} />)

      // Act
      fireEvent.click(screen.getByText('common.operation.add'))

      // Assert
      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })
})
