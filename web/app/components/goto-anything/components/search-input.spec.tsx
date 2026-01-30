import type { ChangeEvent, KeyboardEvent, RefObject } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import SearchInput from './search-input'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => `${options?.ns || 'common'}.${key}`,
  }),
}))

vi.mock('@remixicon/react', () => ({
  RiSearchLine: ({ className }: { className?: string }) => (
    <svg data-testid="search-icon" className={className} />
  ),
}))

vi.mock('@/app/components/workflow/shortcuts-name', () => ({
  default: ({ keys, textColor }: { keys: string[], textColor: string }) => (
    <div data-testid="shortcuts-name" data-keys={keys.join(',')} data-color={textColor}>
      {keys.join('+')}
    </div>
  ),
}))

vi.mock('@/app/components/base/input', async () => {
  const { forwardRef } = await import('react')

  type MockInputProps = {
    value?: string
    placeholder?: string
    onChange?: (e: ChangeEvent<HTMLInputElement>) => void
    onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
    className?: string
    wrapperClassName?: string
    autoFocus?: boolean
  }

  const MockInput = forwardRef<HTMLInputElement, MockInputProps>(
    ({ value, placeholder, onChange, onKeyDown, className, wrapperClassName, autoFocus }, ref) => (
      <input
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        onKeyDown={onKeyDown}
        className={className}
        data-wrapper-class={wrapperClassName}
        autoFocus={autoFocus}
        data-testid="search-input"
      />
    ),
  )
  MockInput.displayName = 'MockInput'

  return { default: MockInput }
})

describe('SearchInput', () => {
  const defaultProps = {
    inputRef: { current: null } as RefObject<HTMLInputElement | null>,
    value: '',
    onChange: vi.fn(),
    searchMode: 'general',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should render search icon', () => {
      render(<SearchInput {...defaultProps} />)

      expect(screen.getByTestId('search-icon')).toBeInTheDocument()
    })

    it('should render input field', () => {
      render(<SearchInput {...defaultProps} />)

      expect(screen.getByTestId('search-input')).toBeInTheDocument()
    })

    it('should render shortcuts name', () => {
      render(<SearchInput {...defaultProps} />)

      const shortcuts = screen.getByTestId('shortcuts-name')
      expect(shortcuts).toBeInTheDocument()
      expect(shortcuts).toHaveAttribute('data-keys', 'ctrl,K')
      expect(shortcuts).toHaveAttribute('data-color', 'secondary')
    })

    it('should use provided placeholder', () => {
      render(<SearchInput {...defaultProps} placeholder="Custom placeholder" />)

      expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument()
    })

    it('should use default placeholder from translation', () => {
      render(<SearchInput {...defaultProps} />)

      expect(screen.getByPlaceholderText('app.gotoAnything.searchPlaceholder')).toBeInTheDocument()
    })
  })

  describe('mode label', () => {
    it('should NOT show mode badge in general mode', () => {
      render(<SearchInput {...defaultProps} searchMode="general" />)

      expect(screen.queryByText('GENERAL')).not.toBeInTheDocument()
    })

    it('should show SCOPES label in scopes mode', () => {
      render(<SearchInput {...defaultProps} searchMode="scopes" />)

      expect(screen.getByText('SCOPES')).toBeInTheDocument()
    })

    it('should show COMMANDS label in commands mode', () => {
      render(<SearchInput {...defaultProps} searchMode="commands" />)

      expect(screen.getByText('COMMANDS')).toBeInTheDocument()
    })

    it('should show APP label in @app mode', () => {
      render(<SearchInput {...defaultProps} searchMode="@app" />)

      expect(screen.getByText('APP')).toBeInTheDocument()
    })

    it('should show PLUGIN label in @plugin mode', () => {
      render(<SearchInput {...defaultProps} searchMode="@plugin" />)

      expect(screen.getByText('PLUGIN')).toBeInTheDocument()
    })

    it('should show KNOWLEDGE label in @knowledge mode', () => {
      render(<SearchInput {...defaultProps} searchMode="@knowledge" />)

      expect(screen.getByText('KNOWLEDGE')).toBeInTheDocument()
    })

    it('should show NODE label in @node mode', () => {
      render(<SearchInput {...defaultProps} searchMode="@node" />)

      expect(screen.getByText('NODE')).toBeInTheDocument()
    })

    it('should uppercase custom mode label', () => {
      render(<SearchInput {...defaultProps} searchMode="@custom" />)

      expect(screen.getByText('CUSTOM')).toBeInTheDocument()
    })
  })

  describe('input interactions', () => {
    it('should call onChange when typing', () => {
      const onChange = vi.fn()
      render(<SearchInput {...defaultProps} onChange={onChange} />)

      const input = screen.getByTestId('search-input')
      fireEvent.change(input, { target: { value: 'test query' } })

      expect(onChange).toHaveBeenCalledWith('test query')
    })

    it('should call onKeyDown when pressing keys', () => {
      const onKeyDown = vi.fn()
      render(<SearchInput {...defaultProps} onKeyDown={onKeyDown} />)

      const input = screen.getByTestId('search-input')
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(onKeyDown).toHaveBeenCalled()
    })

    it('should render with provided value', () => {
      render(<SearchInput {...defaultProps} value="existing query" />)

      expect(screen.getByDisplayValue('existing query')).toBeInTheDocument()
    })

    it('should NOT throw when onKeyDown is undefined', () => {
      render(<SearchInput {...defaultProps} onKeyDown={undefined} />)

      const input = screen.getByTestId('search-input')
      expect(() => fireEvent.keyDown(input, { key: 'Enter' })).not.toThrow()
    })
  })

  describe('styling', () => {
    it('should have search icon styling', () => {
      render(<SearchInput {...defaultProps} />)

      const icon = screen.getByTestId('search-icon')
      expect(icon).toHaveClass('h-4', 'w-4', 'text-text-quaternary')
    })

    it('should have mode badge styling when visible', () => {
      const { container } = render(<SearchInput {...defaultProps} searchMode="@app" />)

      const badge = container.querySelector('.bg-gray-100')
      expect(badge).toBeInTheDocument()
      expect(badge).toHaveClass('rounded', 'px-2', 'text-xs', 'font-medium')
    })
  })
})
