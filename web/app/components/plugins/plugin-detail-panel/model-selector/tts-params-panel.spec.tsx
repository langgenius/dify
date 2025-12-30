import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Import component after mocks
import TTSParamsPanel from './tts-params-panel'

// ==================== Mock Setup ====================
// All vi.mock() calls are hoisted, so inline all mock data

// Mock languages data with inline definition
vi.mock('@/i18n-config/language', () => ({
  languages: [
    { value: 'en-US', name: 'English (United States)', supported: true },
    { value: 'zh-Hans', name: '简体中文', supported: true },
    { value: 'ja-JP', name: '日本語', supported: true },
    { value: 'unsupported-lang', name: 'Unsupported Language', supported: false },
  ],
}))

// Mock PortalSelect component
vi.mock('@/app/components/base/select', () => ({
  PortalSelect: ({
    value,
    items,
    onSelect,
    triggerClassName,
    popupClassName,
    popupInnerClassName,
  }: {
    value: string
    items: Array<{ value: string, name: string }>
    onSelect: (item: { value: string }) => void
    triggerClassName?: string
    popupClassName?: string
    popupInnerClassName?: string
  }) => (
    <div
      data-testid="portal-select"
      data-value={value}
      data-trigger-class={triggerClassName}
      data-popup-class={popupClassName}
      data-popup-inner-class={popupInnerClassName}
    >
      <span data-testid="selected-value">{value}</span>
      <div data-testid="items-container">
        {items.map(item => (
          <button
            key={item.value}
            data-testid={`select-item-${item.value}`}
            onClick={() => onSelect({ value: item.value })}
          >
            {item.name}
          </button>
        ))}
      </div>
    </div>
  ),
}))

// ==================== Test Utilities ====================

/**
 * Factory function to create a voice item
 */
const createVoiceItem = (overrides: Partial<{ mode: string, name: string }> = {}) => ({
  mode: 'alloy',
  name: 'Alloy',
  ...overrides,
})

/**
 * Factory function to create a currentModel with voices
 */
const createCurrentModel = (voices: Array<{ mode: string, name: string }> = []) => ({
  model_properties: {
    voices,
  },
})

/**
 * Factory function to create default props
 */
const createDefaultProps = (overrides: Partial<{
  currentModel: { model_properties: { voices: Array<{ mode: string, name: string }> } } | null
  language: string
  voice: string
  onChange: (language: string, voice: string) => void
}> = {}) => ({
  currentModel: createCurrentModel([
    createVoiceItem({ mode: 'alloy', name: 'Alloy' }),
    createVoiceItem({ mode: 'echo', name: 'Echo' }),
    createVoiceItem({ mode: 'fable', name: 'Fable' }),
  ]),
  language: 'en-US',
  voice: 'alloy',
  onChange: vi.fn(),
  ...overrides,
})

// ==================== Tests ====================

describe('TTSParamsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==================== Rendering Tests ====================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<TTSParamsPanel {...props} />)

      // Assert
      expect(container).toBeInTheDocument()
    })

    it('should render language label', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      expect(screen.getByText('appDebug.voice.voiceSettings.language')).toBeInTheDocument()
    })

    it('should render voice label', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      expect(screen.getByText('appDebug.voice.voiceSettings.voice')).toBeInTheDocument()
    })

    it('should render two PortalSelect components', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      const selects = screen.getAllByTestId('portal-select')
      expect(selects).toHaveLength(2)
    })

    it('should render language select with correct value', () => {
      // Arrange
      const props = createDefaultProps({ language: 'zh-Hans' })

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      const selects = screen.getAllByTestId('portal-select')
      expect(selects[0]).toHaveAttribute('data-value', 'zh-Hans')
    })

    it('should render voice select with correct value', () => {
      // Arrange
      const props = createDefaultProps({ voice: 'echo' })

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      const selects = screen.getAllByTestId('portal-select')
      expect(selects[1]).toHaveAttribute('data-value', 'echo')
    })

    it('should only show supported languages in language select', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('select-item-en-US')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-zh-Hans')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-ja-JP')).toBeInTheDocument()
      expect(screen.queryByTestId('select-item-unsupported-lang')).not.toBeInTheDocument()
    })

    it('should render voice items from currentModel', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('select-item-alloy')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-echo')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-fable')).toBeInTheDocument()
    })
  })

  // ==================== Props Testing ====================
  describe('Props', () => {
    it('should apply trigger className to PortalSelect', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      const selects = screen.getAllByTestId('portal-select')
      expect(selects[0]).toHaveAttribute('data-trigger-class', 'h-8')
      expect(selects[1]).toHaveAttribute('data-trigger-class', 'h-8')
    })

    it('should apply popup className to PortalSelect', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      const selects = screen.getAllByTestId('portal-select')
      expect(selects[0]).toHaveAttribute('data-popup-class', 'z-[1000]')
      expect(selects[1]).toHaveAttribute('data-popup-class', 'z-[1000]')
    })

    it('should apply popup inner className to PortalSelect', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      const selects = screen.getAllByTestId('portal-select')
      expect(selects[0]).toHaveAttribute('data-popup-inner-class', 'w-[354px]')
      expect(selects[1]).toHaveAttribute('data-popup-inner-class', 'w-[354px]')
    })
  })

  // ==================== Event Handlers ====================
  describe('Event Handlers', () => {
    describe('setLanguage', () => {
      it('should call onChange with new language and current voice', () => {
        // Arrange
        const onChange = vi.fn()
        const props = createDefaultProps({
          onChange,
          language: 'en-US',
          voice: 'alloy',
        })

        // Act
        render(<TTSParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('select-item-zh-Hans'))

        // Assert
        expect(onChange).toHaveBeenCalledWith('zh-Hans', 'alloy')
      })

      it('should call onChange with different languages', () => {
        // Arrange
        const onChange = vi.fn()
        const props = createDefaultProps({
          onChange,
          language: 'en-US',
          voice: 'echo',
        })

        // Act
        render(<TTSParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('select-item-ja-JP'))

        // Assert
        expect(onChange).toHaveBeenCalledWith('ja-JP', 'echo')
      })

      it('should preserve voice when changing language', () => {
        // Arrange
        const onChange = vi.fn()
        const props = createDefaultProps({
          onChange,
          language: 'en-US',
          voice: 'fable',
        })

        // Act
        render(<TTSParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('select-item-zh-Hans'))

        // Assert
        expect(onChange).toHaveBeenCalledWith('zh-Hans', 'fable')
      })
    })

    describe('setVoice', () => {
      it('should call onChange with current language and new voice', () => {
        // Arrange
        const onChange = vi.fn()
        const props = createDefaultProps({
          onChange,
          language: 'en-US',
          voice: 'alloy',
        })

        // Act
        render(<TTSParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('select-item-echo'))

        // Assert
        expect(onChange).toHaveBeenCalledWith('en-US', 'echo')
      })

      it('should call onChange with different voices', () => {
        // Arrange
        const onChange = vi.fn()
        const props = createDefaultProps({
          onChange,
          language: 'zh-Hans',
          voice: 'alloy',
        })

        // Act
        render(<TTSParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('select-item-fable'))

        // Assert
        expect(onChange).toHaveBeenCalledWith('zh-Hans', 'fable')
      })

      it('should preserve language when changing voice', () => {
        // Arrange
        const onChange = vi.fn()
        const props = createDefaultProps({
          onChange,
          language: 'ja-JP',
          voice: 'alloy',
        })

        // Act
        render(<TTSParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('select-item-echo'))

        // Assert
        expect(onChange).toHaveBeenCalledWith('ja-JP', 'echo')
      })
    })
  })

  // ==================== Memoization ====================
  describe('Memoization - voiceList', () => {
    it('should return empty array when currentModel is null', () => {
      // Arrange
      const props = createDefaultProps({ currentModel: null })

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert - no voice items should be rendered
      expect(screen.queryByTestId('select-item-alloy')).not.toBeInTheDocument()
      expect(screen.queryByTestId('select-item-echo')).not.toBeInTheDocument()
    })

    it('should return empty array when currentModel is undefined', () => {
      // Arrange
      const props = {
        currentModel: undefined,
        language: 'en-US',
        voice: 'alloy',
        onChange: vi.fn(),
      }

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      expect(screen.queryByTestId('select-item-alloy')).not.toBeInTheDocument()
    })

    it('should map voices with mode as value', () => {
      // Arrange
      const props = createDefaultProps({
        currentModel: createCurrentModel([
          { mode: 'voice-1', name: 'Voice One' },
          { mode: 'voice-2', name: 'Voice Two' },
        ]),
      })

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('select-item-voice-1')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-voice-2')).toBeInTheDocument()
    })

    it('should handle currentModel with empty voices array', () => {
      // Arrange
      const props = createDefaultProps({
        currentModel: createCurrentModel([]),
      })

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert - no voice items (except language items)
      const voiceSelects = screen.getAllByTestId('portal-select')
      // Second select is voice select, should have no voice items in items-container
      const voiceItemsContainer = voiceSelects[1].querySelector('[data-testid="items-container"]')
      expect(voiceItemsContainer?.children).toHaveLength(0)
    })

    it('should handle currentModel with single voice', () => {
      // Arrange
      const props = createDefaultProps({
        currentModel: createCurrentModel([
          { mode: 'single-voice', name: 'Single Voice' },
        ]),
      })

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('select-item-single-voice')).toBeInTheDocument()
    })
  })

  // ==================== Edge Cases ====================
  describe('Edge Cases', () => {
    it('should handle empty language value', () => {
      // Arrange
      const props = createDefaultProps({ language: '' })

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      const selects = screen.getAllByTestId('portal-select')
      expect(selects[0]).toHaveAttribute('data-value', '')
    })

    it('should handle empty voice value', () => {
      // Arrange
      const props = createDefaultProps({ voice: '' })

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      const selects = screen.getAllByTestId('portal-select')
      expect(selects[1]).toHaveAttribute('data-value', '')
    })

    it('should handle many voices', () => {
      // Arrange
      const manyVoices = Array.from({ length: 20 }, (_, i) => ({
        mode: `voice-${i}`,
        name: `Voice ${i}`,
      }))
      const props = createDefaultProps({
        currentModel: createCurrentModel(manyVoices),
      })

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('select-item-voice-0')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-voice-19')).toBeInTheDocument()
    })

    it('should handle voice with special characters in mode', () => {
      // Arrange
      const props = createDefaultProps({
        currentModel: createCurrentModel([
          { mode: 'voice-with_special.chars', name: 'Special Voice' },
        ]),
      })

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('select-item-voice-with_special.chars')).toBeInTheDocument()
    })

    it('should handle onChange not being called multiple times', () => {
      // Arrange
      const onChange = vi.fn()
      const props = createDefaultProps({ onChange })

      // Act
      render(<TTSParamsPanel {...props} />)
      fireEvent.click(screen.getByTestId('select-item-echo'))

      // Assert
      expect(onChange).toHaveBeenCalledTimes(1)
    })
  })

  // ==================== Re-render Behavior ====================
  describe('Re-render Behavior', () => {
    it('should update when language prop changes', () => {
      // Arrange
      const props = createDefaultProps({ language: 'en-US' })

      // Act
      const { rerender } = render(<TTSParamsPanel {...props} />)
      const selects = screen.getAllByTestId('portal-select')
      expect(selects[0]).toHaveAttribute('data-value', 'en-US')

      rerender(<TTSParamsPanel {...props} language="zh-Hans" />)

      // Assert
      const updatedSelects = screen.getAllByTestId('portal-select')
      expect(updatedSelects[0]).toHaveAttribute('data-value', 'zh-Hans')
    })

    it('should update when voice prop changes', () => {
      // Arrange
      const props = createDefaultProps({ voice: 'alloy' })

      // Act
      const { rerender } = render(<TTSParamsPanel {...props} />)
      const selects = screen.getAllByTestId('portal-select')
      expect(selects[1]).toHaveAttribute('data-value', 'alloy')

      rerender(<TTSParamsPanel {...props} voice="echo" />)

      // Assert
      const updatedSelects = screen.getAllByTestId('portal-select')
      expect(updatedSelects[1]).toHaveAttribute('data-value', 'echo')
    })

    it('should update voice list when currentModel changes', () => {
      // Arrange
      const initialModel = createCurrentModel([
        { mode: 'alloy', name: 'Alloy' },
      ])
      const props = createDefaultProps({ currentModel: initialModel })

      // Act
      const { rerender } = render(<TTSParamsPanel {...props} />)
      expect(screen.getByTestId('select-item-alloy')).toBeInTheDocument()
      expect(screen.queryByTestId('select-item-nova')).not.toBeInTheDocument()

      const newModel = createCurrentModel([
        { mode: 'alloy', name: 'Alloy' },
        { mode: 'nova', name: 'Nova' },
      ])
      rerender(<TTSParamsPanel {...props} currentModel={newModel} />)

      // Assert
      expect(screen.getByTestId('select-item-alloy')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-nova')).toBeInTheDocument()
    })

    it('should handle currentModel becoming null', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { rerender } = render(<TTSParamsPanel {...props} />)
      expect(screen.getByTestId('select-item-alloy')).toBeInTheDocument()

      rerender(<TTSParamsPanel {...props} currentModel={null} />)

      // Assert
      expect(screen.queryByTestId('select-item-alloy')).not.toBeInTheDocument()
    })
  })

  // ==================== Component Type ====================
  describe('Component Type', () => {
    it('should be a functional component', () => {
      // Assert
      expect(typeof TTSParamsPanel).toBe('function')
    })

    it('should accept all required props', () => {
      // Arrange
      const props = createDefaultProps()

      // Act & Assert
      expect(() => render(<TTSParamsPanel {...props} />)).not.toThrow()
    })
  })

  // ==================== Accessibility ====================
  describe('Accessibility', () => {
    it('should have proper label structure for language select', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      const languageLabel = screen.getByText('appDebug.voice.voiceSettings.language')
      expect(languageLabel).toHaveClass('system-sm-semibold')
    })

    it('should have proper label structure for voice select', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<TTSParamsPanel {...props} />)

      // Assert
      const voiceLabel = screen.getByText('appDebug.voice.voiceSettings.voice')
      expect(voiceLabel).toHaveClass('system-sm-semibold')
    })
  })
})
