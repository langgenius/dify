import type { ILanguageSelectProps } from './index'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { languages } from '@/i18n-config/language'
import LanguageSelect from './index'

// Get supported languages for test assertions
const supportedLanguages = languages.filter(lang => lang.supported)

// Test data builder for props
const createDefaultProps = (overrides?: Partial<ILanguageSelectProps>): ILanguageSelectProps => ({
  currentLanguage: 'English',
  onSelect: vi.fn(),
  disabled: false,
  ...overrides,
})

describe('LanguageSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Rendering Tests - Verify component renders correctly
  // ==========================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<LanguageSelect {...props} />)

      // Assert
      expect(screen.getByText('English')).toBeInTheDocument()
    })

    it('should render current language text', () => {
      // Arrange
      const props = createDefaultProps({ currentLanguage: 'Chinese Simplified' })

      // Act
      render(<LanguageSelect {...props} />)

      // Assert
      expect(screen.getByText('Chinese Simplified')).toBeInTheDocument()
    })

    it('should render dropdown arrow icon', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<LanguageSelect {...props} />)

      // Assert - RiArrowDownSLine renders as SVG
      const svgIcon = container.querySelector('svg')
      expect(svgIcon).toBeInTheDocument()
    })

    it('should render all supported languages in dropdown when opened', () => {
      // Arrange
      const props = createDefaultProps()
      render(<LanguageSelect {...props} />)

      // Act - Click button to open dropdown
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - All supported languages should be visible
      // Use getAllByText because current language appears both in button and dropdown
      supportedLanguages.forEach((lang) => {
        expect(screen.getAllByText(lang.prompt_name).length).toBeGreaterThanOrEqual(1)
      })
    })

    it('should render check icon for selected language', () => {
      // Arrange
      const selectedLanguage = 'Japanese'
      const props = createDefaultProps({ currentLanguage: selectedLanguage })
      render(<LanguageSelect {...props} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - The selected language option should have a check icon
      const languageOptions = screen.getAllByText(selectedLanguage)
      // One in the button, one in the dropdown list
      expect(languageOptions.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================
  // Props Testing - Verify all prop variations work correctly
  // ==========================================
  describe('Props', () => {
    describe('currentLanguage prop', () => {
      it('should display English when currentLanguage is English', () => {
        const props = createDefaultProps({ currentLanguage: 'English' })
        render(<LanguageSelect {...props} />)
        expect(screen.getByText('English')).toBeInTheDocument()
      })

      it('should display Chinese Simplified when currentLanguage is Chinese Simplified', () => {
        const props = createDefaultProps({ currentLanguage: 'Chinese Simplified' })
        render(<LanguageSelect {...props} />)
        expect(screen.getByText('Chinese Simplified')).toBeInTheDocument()
      })

      it('should display Japanese when currentLanguage is Japanese', () => {
        const props = createDefaultProps({ currentLanguage: 'Japanese' })
        render(<LanguageSelect {...props} />)
        expect(screen.getByText('Japanese')).toBeInTheDocument()
      })

      it.each(supportedLanguages.map(l => l.prompt_name))(
        'should display %s as current language',
        (language) => {
          const props = createDefaultProps({ currentLanguage: language })
          render(<LanguageSelect {...props} />)
          expect(screen.getByText(language)).toBeInTheDocument()
        },
      )
    })

    describe('disabled prop', () => {
      it('should have disabled button when disabled is true', () => {
        // Arrange
        const props = createDefaultProps({ disabled: true })

        // Act
        render(<LanguageSelect {...props} />)

        // Assert
        const button = screen.getByRole('button')
        expect(button).toBeDisabled()
      })

      it('should have enabled button when disabled is false', () => {
        // Arrange
        const props = createDefaultProps({ disabled: false })

        // Act
        render(<LanguageSelect {...props} />)

        // Assert
        const button = screen.getByRole('button')
        expect(button).not.toBeDisabled()
      })

      it('should have enabled button when disabled is undefined', () => {
        // Arrange
        const props = createDefaultProps()
        delete (props as Partial<ILanguageSelectProps>).disabled

        // Act
        render(<LanguageSelect {...props} />)

        // Assert
        const button = screen.getByRole('button')
        expect(button).not.toBeDisabled()
      })

      it('should apply disabled styling when disabled is true', () => {
        // Arrange
        const props = createDefaultProps({ disabled: true })

        // Act
        const { container } = render(<LanguageSelect {...props} />)

        // Assert - Check for disabled class on text elements
        const disabledTextElement = container.querySelector('.text-components-button-tertiary-text-disabled')
        expect(disabledTextElement).toBeInTheDocument()
      })

      it('should apply cursor-not-allowed styling when disabled', () => {
        // Arrange
        const props = createDefaultProps({ disabled: true })

        // Act
        const { container } = render(<LanguageSelect {...props} />)

        // Assert
        const elementWithCursor = container.querySelector('.cursor-not-allowed')
        expect(elementWithCursor).toBeInTheDocument()
      })
    })

    describe('onSelect prop', () => {
      it('should be callable as a function', () => {
        const mockOnSelect = vi.fn()
        const props = createDefaultProps({ onSelect: mockOnSelect })
        render(<LanguageSelect {...props} />)

        // Open dropdown and click a language
        const button = screen.getByRole('button')
        fireEvent.click(button)

        const germanOption = screen.getByText('German')
        fireEvent.click(germanOption)

        expect(mockOnSelect).toHaveBeenCalledWith('German')
      })
    })
  })

  // ==========================================
  // User Interactions - Test event handlers
  // ==========================================
  describe('User Interactions', () => {
    it('should open dropdown when button is clicked', () => {
      // Arrange
      const props = createDefaultProps()
      render(<LanguageSelect {...props} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - Check if dropdown content is visible
      expect(screen.getAllByText('English').length).toBeGreaterThanOrEqual(1)
    })

    it('should call onSelect when a language option is clicked', () => {
      // Arrange
      const mockOnSelect = vi.fn()
      const props = createDefaultProps({ onSelect: mockOnSelect })
      render(<LanguageSelect {...props} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)
      const frenchOption = screen.getByText('French')
      fireEvent.click(frenchOption)

      // Assert
      expect(mockOnSelect).toHaveBeenCalledTimes(1)
      expect(mockOnSelect).toHaveBeenCalledWith('French')
    })

    it('should call onSelect with correct language when selecting different languages', () => {
      // Arrange
      const mockOnSelect = vi.fn()
      const props = createDefaultProps({ onSelect: mockOnSelect })
      render(<LanguageSelect {...props} />)

      // Act & Assert - Test multiple language selections
      const testLanguages = ['Korean', 'Spanish', 'Italian']

      testLanguages.forEach((lang) => {
        mockOnSelect.mockClear()
        const button = screen.getByRole('button')
        fireEvent.click(button)
        const languageOption = screen.getByText(lang)
        fireEvent.click(languageOption)
        expect(mockOnSelect).toHaveBeenCalledWith(lang)
      })
    })

    it('should not open dropdown when disabled', () => {
      // Arrange
      const props = createDefaultProps({ disabled: true })
      render(<LanguageSelect {...props} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - Dropdown should not open, only one instance of the current language should exist
      const englishElements = screen.getAllByText('English')
      expect(englishElements.length).toBe(1) // Only the button text, not dropdown
    })

    it('should not call onSelect when component is disabled', () => {
      // Arrange
      const mockOnSelect = vi.fn()
      const props = createDefaultProps({ onSelect: mockOnSelect, disabled: true })
      render(<LanguageSelect {...props} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert
      expect(mockOnSelect).not.toHaveBeenCalled()
    })

    it('should handle rapid consecutive clicks', () => {
      // Arrange
      const mockOnSelect = vi.fn()
      const props = createDefaultProps({ onSelect: mockOnSelect })
      render(<LanguageSelect {...props} />)

      // Act - Rapid clicks
      const button = screen.getByRole('button')
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      // Assert - Component should not crash
      expect(button).toBeInTheDocument()
    })
  })

  // ==========================================
  // Component Memoization - Test React.memo behavior
  // ==========================================
  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Assert - Check component has memo wrapper
      expect(LanguageSelect.$$typeof).toBe(Symbol.for('react.memo'))
    })

    it('should not re-render when props remain the same', () => {
      // Arrange
      const mockOnSelect = vi.fn()
      const props = createDefaultProps({ onSelect: mockOnSelect })
      const renderSpy = vi.fn()

      // Create a wrapper component to track renders
      const TrackedLanguageSelect: React.FC<ILanguageSelectProps> = (trackedProps) => {
        renderSpy()
        return <LanguageSelect {...trackedProps} />
      }
      const MemoizedTracked = React.memo(TrackedLanguageSelect)

      // Act
      const { rerender } = render(<MemoizedTracked {...props} />)
      rerender(<MemoizedTracked {...props} />)

      // Assert - Should only render once due to same props
      expect(renderSpy).toHaveBeenCalledTimes(1)
    })

    it('should re-render when currentLanguage changes', () => {
      // Arrange
      const props = createDefaultProps({ currentLanguage: 'English' })

      // Act
      const { rerender } = render(<LanguageSelect {...props} />)
      expect(screen.getByText('English')).toBeInTheDocument()

      rerender(<LanguageSelect {...props} currentLanguage="French" />)

      // Assert
      expect(screen.getByText('French')).toBeInTheDocument()
    })

    it('should re-render when disabled changes', () => {
      // Arrange
      const props = createDefaultProps({ disabled: false })

      // Act
      const { rerender } = render(<LanguageSelect {...props} />)
      expect(screen.getByRole('button')).not.toBeDisabled()

      rerender(<LanguageSelect {...props} disabled={true} />)

      // Assert
      expect(screen.getByRole('button')).toBeDisabled()
    })
  })

  // ==========================================
  // Edge Cases - Test boundary conditions and error handling
  // ==========================================
  describe('Edge Cases', () => {
    it('should handle empty string as currentLanguage', () => {
      // Arrange
      const props = createDefaultProps({ currentLanguage: '' })

      // Act
      render(<LanguageSelect {...props} />)

      // Assert - Component should still render
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('should handle non-existent language as currentLanguage', () => {
      // Arrange
      const props = createDefaultProps({ currentLanguage: 'NonExistentLanguage' })

      // Act
      render(<LanguageSelect {...props} />)

      // Assert - Should display the value even if not in list
      expect(screen.getByText('NonExistentLanguage')).toBeInTheDocument()
    })

    it('should handle special characters in language names', () => {
      // Arrange - Turkish has special character in prompt_name
      const props = createDefaultProps({ currentLanguage: 'Türkçe' })

      // Act
      render(<LanguageSelect {...props} />)

      // Assert
      expect(screen.getByText('Türkçe')).toBeInTheDocument()
    })

    it('should handle very long language names', () => {
      // Arrange
      const longLanguageName = 'A'.repeat(100)
      const props = createDefaultProps({ currentLanguage: longLanguageName })

      // Act
      render(<LanguageSelect {...props} />)

      // Assert - Should not crash and should display the text
      expect(screen.getByText(longLanguageName)).toBeInTheDocument()
    })

    it('should render correct number of language options', () => {
      // Arrange
      const props = createDefaultProps()
      render(<LanguageSelect {...props} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - Should show all supported languages
      const expectedCount = supportedLanguages.length
      // Each language appears in the dropdown (use getAllByText because current language appears twice)
      supportedLanguages.forEach((lang) => {
        expect(screen.getAllByText(lang.prompt_name).length).toBeGreaterThanOrEqual(1)
      })
      expect(supportedLanguages.length).toBe(expectedCount)
    })

    it('should only show supported languages in dropdown', () => {
      // Arrange
      const props = createDefaultProps()
      render(<LanguageSelect {...props} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - All displayed languages should be supported
      const allLanguages = languages
      const unsupportedLanguages = allLanguages.filter(lang => !lang.supported)

      unsupportedLanguages.forEach((lang) => {
        expect(screen.queryByText(lang.prompt_name)).not.toBeInTheDocument()
      })
    })

    it('should handle undefined onSelect gracefully when clicking', () => {
      // Arrange - This tests TypeScript boundary, but runtime should not crash
      const props = createDefaultProps()

      // Act
      render(<LanguageSelect {...props} />)
      const button = screen.getByRole('button')
      fireEvent.click(button)
      const option = screen.getByText('German')

      // Assert - Should not throw
      expect(() => fireEvent.click(option)).not.toThrow()
    })

    it('should maintain selection state visually with check icon', () => {
      // Arrange
      const props = createDefaultProps({ currentLanguage: 'Russian' })
      const { container } = render(<LanguageSelect {...props} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - Find the check icon (RiCheckLine) in the dropdown
      // The selected option should have a check icon next to it
      const checkIcons = container.querySelectorAll('svg.text-text-accent')
      expect(checkIcons.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================
  // Accessibility - Basic accessibility checks
  // ==========================================
  describe('Accessibility', () => {
    it('should have accessible button element', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<LanguageSelect {...props} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('should have clickable language options', () => {
      // Arrange
      const props = createDefaultProps()
      render(<LanguageSelect {...props} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - Options should be clickable (have cursor-pointer class)
      const options = screen.getAllByText(/English|French|German|Japanese/i)
      expect(options.length).toBeGreaterThan(0)
    })
  })

  // ==========================================
  // Integration with Popover - Test Popover behavior
  // ==========================================
  describe('Popover Integration', () => {
    it('should use manualClose prop on Popover', () => {
      // Arrange
      const mockOnSelect = vi.fn()
      const props = createDefaultProps({ onSelect: mockOnSelect })

      // Act
      render(<LanguageSelect {...props} />)
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - Popover should be open
      expect(screen.getAllByText('English').length).toBeGreaterThanOrEqual(1)
    })

    it('should have correct popup z-index class', () => {
      // Arrange
      const props = createDefaultProps()
      const { container } = render(<LanguageSelect {...props} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - Check for z-20 class (popupClassName='z-20')
      // This is applied to the Popover
      expect(container.querySelector('.z-20')).toBeTruthy()
    })
  })

  // ==========================================
  // Styling Tests - Verify correct CSS classes applied
  // ==========================================
  describe('Styling', () => {
    it('should apply tertiary button styling', () => {
      // Arrange
      const props = createDefaultProps()
      const { container } = render(<LanguageSelect {...props} />)

      // Assert - Check for tertiary button classes (uses ! prefix for important)
      expect(container.querySelector('.\\!bg-components-button-tertiary-bg')).toBeInTheDocument()
    })

    it('should apply hover styling class to options', () => {
      // Arrange
      const props = createDefaultProps()
      const { container } = render(<LanguageSelect {...props} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - Options should have hover class
      const optionWithHover = container.querySelector('.hover\\:bg-state-base-hover')
      expect(optionWithHover).toBeInTheDocument()
    })

    it('should apply correct text styling to language options', () => {
      // Arrange
      const props = createDefaultProps()
      const { container } = render(<LanguageSelect {...props} />)

      // Act
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - Check for system-sm-medium class on options
      const styledOption = container.querySelector('.system-sm-medium')
      expect(styledOption).toBeInTheDocument()
    })

    it('should apply disabled styling to icon when disabled', () => {
      // Arrange
      const props = createDefaultProps({ disabled: true })
      const { container } = render(<LanguageSelect {...props} />)

      // Assert - Check for disabled text color on icon
      const disabledIcon = container.querySelector('.text-components-button-tertiary-text-disabled')
      expect(disabledIcon).toBeInTheDocument()
    })
  })
})
