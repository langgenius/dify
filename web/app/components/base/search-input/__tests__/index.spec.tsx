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

    it('uses the design-system focus treatment for the clear button', () => {
      render(<SearchInput value="has value" onValueChange={() => {}} />)

      const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })
      expect(clearButton).toHaveClass(
        'size-5',
        'rounded-md',
        'focus-visible:bg-components-input-bg-hover',
        'focus-visible:ring-2',
        'focus-visible:ring-state-accent-solid',
        'focus-visible:ring-inset',
      )
      expect(clearButton).not.toHaveClass('size-4')
      expect(clearButton).not.toHaveClass('absolute')
      expect(clearButton).not.toHaveClass('focus-visible:ring-1')
      expect(clearButton).not.toHaveClass('focus-visible:ring-components-input-border-active')
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

    it('composes the input and adornments with the design-system input group layout', () => {
      const { container } = render(<SearchInput value="" onValueChange={() => {}} />)
      const wrapper = container.firstChild as HTMLElement
      const input = screen.getByRole('searchbox', { name: 'common.operation.search' })
      const searchIcon = wrapper.querySelector('.i-ri-search-line')

      expect(wrapper).toHaveClass(
        'flex',
        'min-h-8',
        'items-center',
        'rounded-lg',
        'border',
        'bg-components-input-bg-normal',
        'focus-within:border-components-input-border-active',
        'focus-within:bg-components-input-bg-active',
      )
      expect(searchIcon).toHaveAttribute('aria-hidden', 'true')
      expect(input).toHaveClass('w-0', 'min-w-0', 'flex-1', 'bg-transparent', 'px-1')
      expect(input).not.toHaveClass('ps-7')
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
