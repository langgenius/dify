import { fireEvent, render, screen } from '@testing-library/react'
import AddButton from './add-button'

describe('AddButton', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<AddButton onClick={vi.fn()} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render an add icon', () => {
      render(<AddButton onClick={vi.fn()} />)
      const iconSpan = screen.getByTestId('add-button').querySelector('span')
      expect(iconSpan).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<AddButton onClick={vi.fn()} className="my-custom" />)
      expect(container.firstChild).toHaveClass('my-custom')
    })

    it('should retain base classes when custom className is applied', () => {
      const { container } = render(<AddButton onClick={vi.fn()} className="my-custom" />)
      expect(container.firstChild).toHaveClass('cursor-pointer')
      expect(container.firstChild).toHaveClass('rounded-md')
      expect(container.firstChild).toHaveClass('select-none')
    })
  })

  describe('User Interactions', () => {
    it('should call onClick when clicked', () => {
      const onClick = vi.fn()
      const { container } = render(<AddButton onClick={onClick} />)
      fireEvent.click(container.firstChild!)
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should call onClick multiple times on repeated clicks', () => {
      const onClick = vi.fn()
      const { container } = render(<AddButton onClick={onClick} />)
      fireEvent.click(container.firstChild!)
      fireEvent.click(container.firstChild!)
      fireEvent.click(container.firstChild!)
      expect(onClick).toHaveBeenCalledTimes(3)
    })
  })
})
