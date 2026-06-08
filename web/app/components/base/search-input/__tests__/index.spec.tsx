import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { SearchInput } from '..'

describe('SearchInput', () => {
  describe('Render', () => {
    it('renders correctly with default props', () => {
      render(<SearchInput value="" onValueChange={() => {}} />)
      const input = screen.getByRole('searchbox', { name: 'common.operation.search' })
      expect(input).toBeInTheDocument()
      expect(input).toHaveValue('')
      expect(input).toHaveAttribute('name', 'query')
      expect(input).toHaveAttribute('autocomplete', 'off')
    })

    it('renders custom placeholder', () => {
      render(<SearchInput value="" onValueChange={() => {}} placeholder="Custom Placeholder" />)
      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toHaveAttribute('placeholder', 'Custom Placeholder')
    })

    it('uses custom aria label', () => {
      render(<SearchInput value="" onValueChange={() => {}} aria-label="Search providers" />)
      expect(screen.getByRole('searchbox', { name: 'Search providers' })).toBeInTheDocument()
    })

    it('focuses the searchbox when autoFocus is enabled', () => {
      render(<SearchInput value="" onValueChange={() => {}} autoFocus />)
      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toHaveFocus()
    })

    it('shows clear button when value is present', () => {
      const onValueChange = vi.fn()
      render(<SearchInput value="has value" onValueChange={onValueChange} />)

      const clearButton = screen.getByLabelText('common.operation.clear')
      expect(clearButton).toBeInTheDocument()
    })
  })

  describe('Interaction', () => {
    it('calls onValueChange when typing', () => {
      const onValueChange = vi.fn()
      render(<SearchInput value="" onValueChange={onValueChange} />)
      const input = screen.getByRole('searchbox', { name: 'common.operation.search' })

      fireEvent.change(input, { target: { value: 'test' } })
      expect(onValueChange).toHaveBeenCalledWith('test')
    })

    it('handles composition events', () => {
      const onValueChange = vi.fn()
      render(<SearchInput value="initial" onValueChange={onValueChange} />)
      const input = screen.getByRole('searchbox', { name: 'common.operation.search' })

      fireEvent.compositionStart(input)
      fireEvent.change(input, { target: { value: 'final' } })

      expect(onValueChange).not.toHaveBeenCalled()
      expect(input).toHaveValue('final')

      fireEvent.compositionEnd(input)
      expect(onValueChange).toHaveBeenCalledTimes(1)
      expect(onValueChange).toHaveBeenCalledWith('final')
    })

    it('does not keep stale composition commits after the next distinct change', () => {
      const onValueChange = vi.fn()

      function ControlledSearchInput() {
        const [value, setValue] = useState('initial')

        return (
          <SearchInput
            value={value}
            onValueChange={(nextValue) => {
              onValueChange(nextValue)
              setValue(nextValue)
            }}
          />
        )
      }

      render(<ControlledSearchInput />)
      const input = screen.getByRole('searchbox', { name: 'common.operation.search' })

      fireEvent.compositionStart(input)
      fireEvent.change(input, { target: { value: 'final' } })
      fireEvent.compositionEnd(input)
      fireEvent.change(input, { target: { value: 'finalx' } })
      fireEvent.change(input, { target: { value: 'final' } })

      expect(onValueChange).toHaveBeenCalledTimes(3)
      expect(onValueChange).toHaveBeenNthCalledWith(1, 'final')
      expect(onValueChange).toHaveBeenNthCalledWith(2, 'finalx')
      expect(onValueChange).toHaveBeenNthCalledWith(3, 'final')
    })

    it('clears composition value without committing stale text', () => {
      const onValueChange = vi.fn()

      function ControlledSearchInput() {
        const [value, setValue] = useState('initial')

        return (
          <SearchInput
            value={value}
            onValueChange={(nextValue) => {
              onValueChange(nextValue)
              setValue(nextValue)
            }}
          />
        )
      }

      render(<ControlledSearchInput />)
      const input = screen.getByRole('searchbox', { name: 'common.operation.search' })

      fireEvent.compositionStart(input)
      fireEvent.change(input, { target: { value: 'final' } })
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.clear' }))
      fireEvent.compositionEnd(input)

      expect(input).toHaveValue('')
      expect(onValueChange).toHaveBeenCalledTimes(1)
      expect(onValueChange).toHaveBeenCalledWith('')
    })

    it('calls onValueChange with empty string when clear button is clicked', () => {
      const onValueChange = vi.fn()
      render(<SearchInput value="has value" onValueChange={onValueChange} />)

      const clearButton = screen.getByLabelText('common.operation.clear')
      fireEvent.click(clearButton)
      expect(onValueChange).toHaveBeenCalledWith('')
    })

    it('uses dify-ui input spacing for the search adornment', () => {
      render(<SearchInput value="" onValueChange={() => {}} />)
      const input = screen.getByRole('searchbox', { name: 'common.operation.search' })
      expect(input).toHaveClass('ps-7')
      expect(input).not.toHaveClass('h-[18px]')
    })
  })

  describe('Style', () => {
    it('applies custom className', () => {
      const { container } = render(<SearchInput value="" onValueChange={() => {}} className="custom-test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-test')
    })
  })
})
