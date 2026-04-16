import type { ILanguageSelectProps } from '../index'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { languages } from '@/i18n-config/language'
import LanguageSelect from '../index'

const supportedLanguages = languages.filter(language => language.supported)

const createDefaultProps = (overrides?: Partial<ILanguageSelectProps>): ILanguageSelectProps => ({
  currentLanguage: 'English',
  onSelect: vi.fn(),
  disabled: false,
  ...overrides,
})

const openSelect = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('combobox', { name: 'language' }))
  })
  return screen.findByRole('listbox')
}

describe('LanguageSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering
  describe('Rendering', () => {
    it('should render the current language in the trigger', () => {
      render(<LanguageSelect {...createDefaultProps()} />)

      const trigger = screen.getByRole('combobox', { name: 'language' })
      expect(trigger).toBeInTheDocument()
      expect(trigger).toHaveTextContent('English')
    })

    it('should render non-listed current language values', () => {
      render(<LanguageSelect {...createDefaultProps({ currentLanguage: 'NonExistentLanguage' })} />)

      expect(screen.getByRole('combobox', { name: 'language' })).toHaveTextContent('NonExistentLanguage')
    })

    it('should render a placeholder when current language is empty', () => {
      render(<LanguageSelect {...createDefaultProps({ currentLanguage: '' })} />)

      expect(screen.getByRole('combobox', { name: 'language' }).textContent).toBe('\u00A0')
    })
  })

  // Dropdown behavior
  describe('Dropdown behavior', () => {
    it('should render all supported languages when the select is opened', async () => {
      render(<LanguageSelect {...createDefaultProps()} />)

      expect(await openSelect()).toBeInTheDocument()
      supportedLanguages.forEach((language) => {
        expect(screen.getByRole('option', { name: language.prompt_name })).toBeInTheDocument()
      })
    })

    it('should only render supported languages in the dropdown', async () => {
      render(<LanguageSelect {...createDefaultProps()} />)

      await openSelect()

      const unsupportedLanguages = languages.filter(language => !language.supported)
      unsupportedLanguages.forEach((language) => {
        expect(screen.queryByRole('option', { name: language.prompt_name })).not.toBeInTheDocument()
      })
    })

    it('should mark the selected language inside the opened list', async () => {
      render(<LanguageSelect {...createDefaultProps({ currentLanguage: 'Japanese' })} />)

      await openSelect()

      const selectedOption = await screen.findByRole('option', { name: 'Japanese' })
      expect(selectedOption).toHaveAttribute('aria-selected', 'true')
    })
  })

  // Interaction
  describe('Interaction', () => {
    it('should call onSelect when a different language is chosen', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      render(<LanguageSelect {...createDefaultProps({ onSelect })} />)

      await user.click(screen.getByRole('combobox', { name: 'language' }))
      const listbox = await screen.findByRole('listbox')
      await user.click(within(listbox).getByRole('option', { name: 'French' }))

      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledTimes(1)
        expect(onSelect).toHaveBeenCalledWith('French')
      })
    })

    it('should re-render with the new language value', () => {
      const { rerender } = render(<LanguageSelect {...createDefaultProps()} />)

      rerender(<LanguageSelect {...createDefaultProps({ currentLanguage: 'French' })} />)

      expect(screen.getByRole('combobox', { name: 'language' })).toHaveTextContent('French')
    })

    it('should ignore null values emitted by the select control', async () => {
      vi.resetModules()
      vi.doMock('@/app/components/base/ui/select', () => ({
        Select: ({ onValueChange, children }: { onValueChange?: (value: string | null) => void, children: React.ReactNode }) => {
          React.useEffect(() => {
            onValueChange?.(null)
          }, [onValueChange])
          return <div>{children}</div>
        },
        SelectTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
        SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        SelectItemText: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
        SelectItemIndicator: () => null,
      }))

      const { default: IsolatedLanguageSelect } = await import('../index')
      const onSelect = vi.fn()

      render(<IsolatedLanguageSelect currentLanguage="English" onSelect={onSelect} />)

      await waitFor(() => {
        expect(onSelect).not.toHaveBeenCalled()
      })

      vi.doUnmock('@/app/components/base/ui/select')
    })
  })

  // Disabled state
  describe('Disabled state', () => {
    it('should disable the trigger when disabled is true', () => {
      render(<LanguageSelect {...createDefaultProps({ disabled: true })} />)

      const trigger = screen.getByRole('combobox', { name: 'language' })
      expect(trigger).toBeDisabled()
      expect(trigger).toHaveClass('cursor-not-allowed')
    })

    it('should not open the listbox when disabled', () => {
      render(<LanguageSelect {...createDefaultProps({ disabled: true })} />)

      fireEvent.click(screen.getByRole('combobox', { name: 'language' }))

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })

  // Styling and memoization
  describe('Styling and memoization', () => {
    it('should apply the compact tertiary trigger styles', () => {
      render(<LanguageSelect {...createDefaultProps()} />)

      const trigger = screen.getByRole('combobox', { name: 'language' })
      expect(trigger).toHaveClass('mx-1', 'bg-components-button-tertiary-bg', 'text-components-button-tertiary-text')
    })

    it('should be wrapped with React.memo', () => {
      expect(LanguageSelect.$$typeof).toBe(Symbol.for('react.memo'))
    })

    it('should avoid re-rendering when props stay the same', () => {
      const renderSpy = vi.fn()
      const props = createDefaultProps()

      const TrackedLanguageSelect: React.FC<ILanguageSelectProps> = (trackedProps) => {
        renderSpy()
        return <LanguageSelect {...trackedProps} />
      }
      const MemoizedTracked = React.memo(TrackedLanguageSelect)

      const { rerender } = render(<MemoizedTracked {...props} />)
      rerender(<MemoizedTracked {...props} />)

      expect(renderSpy).toHaveBeenCalledTimes(1)
    })
  })
})
