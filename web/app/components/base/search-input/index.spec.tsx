import { fireEvent, render, screen } from '@testing-library/react'
import SearchInput from '.'

describe('SearchInput', () => {
  describe('Render', () => {
    it('renders correctly with default props', () => {
      render(<SearchInput value="" onChange={() => {}} />)
      const input = screen.getByPlaceholderText('common.operation.search')
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('')
    })

    it('renders custom placeholder', () => {
      render(<SearchInput value="" onChange={() => {}} placeholder="Custom Placeholder" />)
      expect(screen.getByPlaceholderText('Custom Placeholder')).toBeInTheDocument()
    })

    it('shows clear button when value is present', () => {
      const onChange = vi.fn()
      render(<SearchInput value="has value" onChange={onChange} />)

      const clearButton = screen.getByLabelText('common.operation.clear')
      expect(clearButton).toBeInTheDocument()
    })
  })

  describe('Interaction', () => {
    it('calls onChange when typing', () => {
      const onChange = vi.fn()
      render(<SearchInput value="" onChange={onChange} />)
      const input = screen.getByPlaceholderText('common.operation.search')

      fireEvent.change(input, { target: { value: 'test' } })
      expect(onChange).toHaveBeenCalledWith('test')
    })

    it('handles composition events', () => {
      const onChange = vi.fn()
      render(<SearchInput value="initial" onChange={onChange} />)
      const input = screen.getByPlaceholderText('common.operation.search')

      // Start composition
      fireEvent.compositionStart(input)
      fireEvent.change(input, { target: { value: 'final' } })

      // While composing, onChange should NOT be called
      expect(onChange).not.toHaveBeenCalled()
      expect(input).toHaveValue('final')

      // End composition
      fireEvent.compositionEnd(input)
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('final')
    })

    it('calls onChange with empty string when clear button is clicked', () => {
      const onChange = vi.fn()
      render(<SearchInput value="has value" onChange={onChange} />)

      const clearButton = screen.getByLabelText('common.operation.clear')
      fireEvent.click(clearButton)
      expect(onChange).toHaveBeenCalledWith('')
    })

    it('updates focus state on focus/blur', () => {
      const { container } = render(<SearchInput value="" onChange={() => {}} />)
      const wrapper = container.firstChild as HTMLElement
      const input = screen.getByPlaceholderText('common.operation.search')

      fireEvent.focus(input)
      expect(wrapper).toHaveClass(/bg-components-input-bg-active/)

      fireEvent.blur(input)
      expect(wrapper).not.toHaveClass(/bg-components-input-bg-active/)
    })
  })

  describe('Style', () => {
    it('applies white style', () => {
      const { container } = render(<SearchInput value="" onChange={() => {}} white />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('!bg-white')
    })

    it('applies custom className', () => {
      const { container } = render(<SearchInput value="" onChange={() => {}} className="custom-test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-test')
    })
  })
})
