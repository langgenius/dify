import { fireEvent, render, screen } from '@testing-library/react'
import { VariableMenuItem } from './variable-option'

describe('VariableMenuItem', () => {
  const defaultProps = {
    title: 'Variable Name',
    isSelected: false,
    queryString: null,
    onClick: vi.fn(),
    onMouseEnter: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the title correctly', () => {
      render(<VariableMenuItem {...defaultProps} />)
      expect(screen.getByText('Variable Name')).toBeInTheDocument()
      expect(screen.getByTitle('Variable Name')).toBeInTheDocument()
    })

    it('should render the icon when provided', () => {
      render(
        <VariableMenuItem
          {...defaultProps}
          icon={<span data-testid="test-icon">icon</span>}
        />,
      )
      expect(screen.getByTestId('test-icon')).toBeInTheDocument()
    })

    it('should render the extra element when provided', () => {
      render(
        <VariableMenuItem
          {...defaultProps}
          extraElement={<span data-testid="extra">extra</span>}
        />,
      )
      expect(screen.getByTestId('extra')).toBeInTheDocument()
    })

    it('should apply selection styles when isSelected is true', () => {
      const { container } = render(<VariableMenuItem {...defaultProps} isSelected={true} />)
      const item = container.firstChild as HTMLElement
      expect(item).toHaveClass('bg-state-base-hover')
    })
  })

  describe('Highlighting Logic (queryString)', () => {
    it('should not highlight anything when queryString is null', () => {
      render(<VariableMenuItem {...defaultProps} queryString={null} />)
      const titleContainer = screen.getByTitle('Variable Name')
      // Ensure no highlighted span with text exists
      expect(titleContainer.querySelector('.text-text-accent')?.textContent).toBe('')
    })

    it('should highlight matching text case-insensitively', () => {
      render(<VariableMenuItem {...defaultProps} title="User Name" queryString="user" />)
      const highlighted = screen.getByText('User')
      expect(highlighted).toHaveClass('text-text-accent')

      const titleContainer = screen.getByTitle('User Name')
      expect(titleContainer.textContent).toBe('User Name')
    })

    it('should handle partial match in the middle of the string', () => {
      render(<VariableMenuItem {...defaultProps} title="System Variable" queryString="tem" />)
      const highlighted = screen.getByText('tem')
      expect(highlighted).toHaveClass('text-text-accent')

      const titleContainer = screen.getByTitle('System Variable')
      expect(titleContainer.textContent).toBe('System Variable')
      expect(titleContainer.innerHTML).toContain('Sys')
      expect(titleContainer.innerHTML).toContain(' Variable')
    })

    it('should handle no match gracefully', () => {
      render(<VariableMenuItem {...defaultProps} title="Variable" queryString="xyz" />)
      expect(screen.getByText('Variable')).toBeInTheDocument()
      const titleContainer = screen.getByTitle('Variable')
      expect(titleContainer.querySelector('.text-text-accent')?.textContent).toBe('')
    })
  })

  describe('Events', () => {
    it('should trigger onClick when clicked', () => {
      render(<VariableMenuItem {...defaultProps} />)
      fireEvent.click(screen.getByTitle('Variable Name'))
      expect(defaultProps.onClick).toHaveBeenCalledTimes(1)
    })

    it('should trigger onMouseEnter when mouse enters', () => {
      render(<VariableMenuItem {...defaultProps} />)
      fireEvent.mouseEnter(screen.getByTitle('Variable Name'))
      expect(defaultProps.onMouseEnter).toHaveBeenCalledTimes(1)
    })

    it('should prevent default and stop propagation onMouseDown', () => {
      render(<VariableMenuItem {...defaultProps} />)
      const mousedownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      })
      const preventDefaultSpy = vi.spyOn(mousedownEvent, 'preventDefault')
      const stopPropagationSpy = vi.spyOn(mousedownEvent, 'stopPropagation')

      fireEvent(screen.getByTitle('Variable Name'), mousedownEvent)

      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(stopPropagationSpy).toHaveBeenCalled()
    })
  })

  describe('Ref handling', () => {
    it('should call setRefElement with the element', () => {
      const setRefElement = vi.fn()
      render(<VariableMenuItem {...defaultProps} setRefElement={setRefElement} />)

      expect(setRefElement).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    })
  })
})
