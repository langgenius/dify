import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
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
      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toHaveAttribute(
        'placeholder',
        'Custom Placeholder',
      )
    })

    it('uses custom aria label', () => {
      render(<SearchInput value="" onValueChange={() => {}} aria-label="Search providers" />)
      expect(screen.getByRole('searchbox', { name: 'Search providers' })).toBeInTheDocument()
    })

    it('uses a custom form name', () => {
      render(<SearchInput name="provider-query" value="" onValueChange={() => {}} />)
      expect(screen.getByRole('searchbox')).toHaveAttribute('name', 'provider-query')
    })

    it('exposes the input element through its ref', () => {
      const ref = createRef<HTMLInputElement>()
      render(<SearchInput ref={ref} value="" onValueChange={() => {}} />)

      expect(ref.current).toBe(screen.getByRole('searchbox', { name: 'common.operation.search' }))
    })

    it('focuses the searchbox when autoFocus is enabled', () => {
      // oxlint-disable-next-line jsx-a11y/no-autofocus
      render(<SearchInput value="" onValueChange={() => {}} autoFocus />)
      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toHaveFocus()
    })

    it('shows clear button when value is present', () => {
      const onValueChange = vi.fn()
      render(<SearchInput value="has value" onValueChange={onValueChange} />)

      const clearButton = screen.getByLabelText('common.operation.clear')
      expect(clearButton).toBeInTheDocument()
    })

    it('keeps a disabled searchbox inert and exposes its description', () => {
      render(
        <>
          <SearchInput
            disabled
            aria-describedby="search-unavailable"
            value="has value"
            onValueChange={() => {}}
          />
          <span id="search-unavailable">Search unavailable</span>
        </>,
      )

      const searchbox = screen.getByRole('searchbox', { name: 'common.operation.search' })
      expect(searchbox).toBeDisabled()
      expect(searchbox).toHaveAccessibleDescription('Search unavailable')
      expect(
        screen.queryByRole('button', { name: 'common.operation.clear' }),
      ).not.toBeInTheDocument()
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

    it('clears the value and returns focus to the searchbox', async () => {
      const user = userEvent.setup()

      function ControlledSearchInput() {
        const [value, setValue] = useState('has value')

        return <SearchInput value={value} onValueChange={setValue} />
      }

      render(<ControlledSearchInput />)

      const clearButton = screen.getByLabelText('common.operation.clear')
      await user.click(clearButton)

      const searchbox = screen.getByRole('searchbox', { name: 'common.operation.search' })
      expect(searchbox).toHaveValue('')
      expect(searchbox).toHaveFocus()
    })
  })
})
