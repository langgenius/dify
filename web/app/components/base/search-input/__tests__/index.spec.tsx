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
      expect(input).toHaveAttribute('type', 'text')
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

    it('cleans up callback refs when the owner replaces the ref or unmounts', () => {
      const cleanup = vi.fn()
      const ref = vi.fn(() => cleanup)
      const nextRef = createRef<HTMLInputElement>()
      const { rerender, unmount } = render(
        <SearchInput ref={ref} value="" onValueChange={() => {}} />,
      )
      const input = screen.getByRole('searchbox')
      expect(ref).toHaveBeenCalledWith(input)

      rerender(<SearchInput ref={nextRef} value="" onValueChange={() => {}} />)
      expect(cleanup).toHaveBeenCalledOnce()
      expect(nextRef.current).toBe(input)

      unmount()
      expect(nextRef.current).toBeNull()
    })

    it('focuses the searchbox when autoFocus is enabled', () => {
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- The case exercises the autoFocus prop itself.
      render(<SearchInput value="" onValueChange={() => {}} autoFocus />)
      expect(screen.getByRole('searchbox', { name: 'common.operation.search' })).toHaveFocus()
    })

    it('shows clear button when value is present', () => {
      const onValueChange = vi.fn()
      render(<SearchInput value="has value" onValueChange={onValueChange} />)

      const clearButton = screen.getByLabelText('common.operation.clear')
      expect(clearButton).toBeInTheDocument()
      expect(clearButton).toHaveAttribute('tabindex', '-1')
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

    it('keeps focus in the searchbox while the clear button is pressed', async () => {
      const user = userEvent.setup()

      function ControlledSearchInput() {
        const [value, setValue] = useState('has value')

        return <SearchInput value={value} onValueChange={setValue} />
      }

      render(<ControlledSearchInput />)
      const searchbox = screen.getByRole('searchbox', { name: 'common.operation.search' })
      const onBlur = vi.fn()
      searchbox.addEventListener('blur', onBlur)
      searchbox.focus()

      await user.pointer({
        keys: '[MouseLeft>]',
        target: screen.getByLabelText('common.operation.clear'),
      })
      expect(searchbox).toHaveFocus()

      await user.pointer({ keys: '[/MouseLeft]' })
      expect(searchbox).toHaveValue('')
      expect(searchbox).toHaveFocus()
      expect(onBlur).not.toHaveBeenCalled()
    })

    it('clears on Escape and keeps the key from the owning dialog while it has a value', async () => {
      const user = userEvent.setup()
      // Base UI dismissal listens for Escape on the document, so a swallowed key never reaches it.
      const onDocumentKeyDown = vi.fn()
      document.addEventListener('keydown', onDocumentKeyDown)

      function ControlledSearchInput() {
        const [value, setValue] = useState('has value')

        return <SearchInput value={value} onValueChange={setValue} />
      }

      try {
        render(<ControlledSearchInput />)
        const searchbox = screen.getByRole('searchbox', { name: 'common.operation.search' })
        searchbox.focus()

        await user.keyboard('{Escape}')

        expect(searchbox).toHaveValue('')
        expect(searchbox).toHaveFocus()
        expect(onDocumentKeyDown).not.toHaveBeenCalled()
      } finally {
        document.removeEventListener('keydown', onDocumentKeyDown)
      }
    })

    it('lets Escape reach the owning dialog when the searchbox is empty', async () => {
      const user = userEvent.setup()
      const onDocumentKeyDown = vi.fn()
      document.addEventListener('keydown', onDocumentKeyDown)

      try {
        render(<SearchInput value="" onValueChange={() => {}} />)
        screen.getByRole('searchbox', { name: 'common.operation.search' }).focus()

        await user.keyboard('{Escape}')

        expect(onDocumentKeyDown).toHaveBeenCalledOnce()
      } finally {
        document.removeEventListener('keydown', onDocumentKeyDown)
      }
    })

    it('leaves Escape to the IME during composition', () => {
      const onValueChange = vi.fn()
      render(<SearchInput value="initial" onValueChange={onValueChange} />)
      const input = screen.getByRole('searchbox', { name: 'common.operation.search' })

      fireEvent.compositionStart(input)
      fireEvent.change(input, { target: { value: 'final' } })
      fireEvent.keyDown(input, { key: 'Escape' })

      expect(input).toHaveValue('final')
      expect(onValueChange).not.toHaveBeenCalled()
    })
  })
})
