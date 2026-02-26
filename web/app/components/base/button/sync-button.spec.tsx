import { fireEvent, render, screen } from '@testing-library/react'
import SyncButton from './sync-button'

describe('SyncButton', () => {
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<SyncButton onClick={vi.fn()} />)
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render a refresh icon', () => {
      render(<SyncButton onClick={vi.fn()} />)
      const iconSpan = screen.getByTestId('sync-button').querySelector('span')
      expect(iconSpan).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      render(<SyncButton onClick={vi.fn()} className="my-custom" />)
      const clickableDiv = screen.getByTestId('sync-button')
      expect(clickableDiv).toHaveClass('my-custom')
    })

    it('should retain base classes when custom className is applied', () => {
      render(<SyncButton onClick={vi.fn()} className="my-custom" />)
      const clickableDiv = screen.getByTestId('sync-button')
      expect(clickableDiv).toHaveClass('rounded-md')
      expect(clickableDiv).toHaveClass('select-none')
    })
  })

  describe('User Interactions', () => {
    it('should call onClick when clicked', () => {
      const onClick = vi.fn()
      render(<SyncButton onClick={onClick} />)
      const clickableDiv = screen.getByTestId('sync-button')
      fireEvent.click(clickableDiv)
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('should call onClick multiple times on repeated clicks', () => {
      const onClick = vi.fn()
      render(<SyncButton onClick={onClick} />)
      const clickableDiv = screen.getByTestId('sync-button')
      fireEvent.click(clickableDiv)
      fireEvent.click(clickableDiv)
      fireEvent.click(clickableDiv)
      expect(onClick).toHaveBeenCalledTimes(3)
    })
  })
})
