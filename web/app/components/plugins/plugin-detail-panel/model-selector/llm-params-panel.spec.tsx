import type { FormValue, ModelParameterRule } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Import component after mocks
import LLMParamsPanel from './llm-params-panel'

// ==================== Mock Setup ====================
// All vi.mock() calls are hoisted, so inline all mock data

// Mock useModelParameterRules hook
const mockUseModelParameterRules = vi.fn()
vi.mock('@/service/use-common', () => ({
  useModelParameterRules: (provider: string, modelId: string) => mockUseModelParameterRules(provider, modelId),
}))

// Mock config constants with inline data
vi.mock('@/config', () => ({
  TONE_LIST: [
    {
      id: 1,
      name: 'Creative',
      config: {
        temperature: 0.8,
        top_p: 0.9,
        presence_penalty: 0.1,
        frequency_penalty: 0.1,
      },
    },
    {
      id: 2,
      name: 'Balanced',
      config: {
        temperature: 0.5,
        top_p: 0.85,
        presence_penalty: 0.2,
        frequency_penalty: 0.3,
      },
    },
    {
      id: 3,
      name: 'Precise',
      config: {
        temperature: 0.2,
        top_p: 0.75,
        presence_penalty: 0.5,
        frequency_penalty: 0.5,
      },
    },
    {
      id: 4,
      name: 'Custom',
    },
  ],
  STOP_PARAMETER_RULE: {
    default: [],
    help: {
      en_US: 'Stop sequences help text',
      zh_Hans: '停止序列帮助文本',
    },
    label: {
      en_US: 'Stop sequences',
      zh_Hans: '停止序列',
    },
    name: 'stop',
    required: false,
    type: 'tag',
    tagPlaceholder: {
      en_US: 'Enter sequence and press Tab',
      zh_Hans: '输入序列并按 Tab 键',
    },
  },
  PROVIDER_WITH_PRESET_TONE: ['langgenius/openai/openai', 'langgenius/azure_openai/azure_openai'],
}))

// Mock PresetsParameter component
vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal/presets-parameter', () => ({
  default: ({ onSelect }: { onSelect: (toneId: number) => void }) => (
    <div data-testid="presets-parameter">
      <button data-testid="preset-creative" onClick={() => onSelect(1)}>Creative</button>
      <button data-testid="preset-balanced" onClick={() => onSelect(2)}>Balanced</button>
      <button data-testid="preset-precise" onClick={() => onSelect(3)}>Precise</button>
      <button data-testid="preset-custom" onClick={() => onSelect(4)}>Custom</button>
    </div>
  ),
}))

// Mock ParameterItem component
vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal/parameter-item', () => ({
  default: ({ parameterRule, value, onChange, onSwitch, isInWorkflow }: {
    parameterRule: { name: string, label: { en_US: string }, default?: unknown }
    value: unknown
    onChange: (v: unknown) => void
    onSwitch: (checked: boolean, assignValue: unknown) => void
    isInWorkflow?: boolean
  }) => (
    <div
      data-testid={`parameter-item-${parameterRule.name}`}
      data-value={JSON.stringify(value)}
      data-is-in-workflow={isInWorkflow}
    >
      <span>{parameterRule.label.en_US}</span>
      <button data-testid={`change-${parameterRule.name}`} onClick={() => onChange(0.5)}>Change</button>
      <button data-testid={`switch-on-${parameterRule.name}`} onClick={() => onSwitch(true, parameterRule.default)}>Switch On</button>
      <button data-testid={`switch-off-${parameterRule.name}`} onClick={() => onSwitch(false, parameterRule.default)}>Switch Off</button>
    </div>
  ),
}))

// ==================== Test Utilities ====================

/**
 * Factory function to create a ModelParameterRule with defaults
 */
const createParameterRule = (overrides: Partial<ModelParameterRule> = {}): ModelParameterRule => ({
  name: 'temperature',
  label: { en_US: 'Temperature', zh_Hans: '温度' },
  type: 'float',
  default: 0.7,
  min: 0,
  max: 2,
  precision: 2,
  required: false,
  ...overrides,
})

/**
 * Factory function to create default props
 */
const createDefaultProps = (overrides: Partial<{
  isAdvancedMode: boolean
  provider: string
  modelId: string
  completionParams: FormValue
  onCompletionParamsChange: (newParams: FormValue) => void
}> = {}) => ({
  isAdvancedMode: false,
  provider: 'langgenius/openai/openai',
  modelId: 'gpt-4',
  completionParams: {},
  onCompletionParamsChange: vi.fn(),
  ...overrides,
})

/**
 * Setup mock for useModelParameterRules
 */
const setupModelParameterRulesMock = (config: {
  data?: ModelParameterRule[]
  isPending?: boolean
} = {}) => {
  mockUseModelParameterRules.mockReturnValue({
    data: config.data ? { data: config.data } : undefined,
    isPending: config.isPending ?? false,
  })
}

// ==================== Tests ====================

describe('LLMParamsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupModelParameterRulesMock({ data: [], isPending: false })
  })

  // ==================== Rendering Tests ====================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<LLMParamsPanel {...props} />)

      // Assert
      expect(container).toBeInTheDocument()
    })

    it('should render loading state when isPending is true', () => {
      // Arrange
      setupModelParameterRulesMock({ isPending: true })
      const props = createDefaultProps()

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert - Loading component uses aria-label instead of visible text
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should render parameters header', () => {
      // Arrange
      setupModelParameterRulesMock({ data: [], isPending: false })
      const props = createDefaultProps()

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.getByText('common.modelProvider.parameters')).toBeInTheDocument()
    })

    it('should render PresetsParameter for openai provider', () => {
      // Arrange
      setupModelParameterRulesMock({ data: [], isPending: false })
      const props = createDefaultProps({ provider: 'langgenius/openai/openai' })

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('presets-parameter')).toBeInTheDocument()
    })

    it('should render PresetsParameter for azure_openai provider', () => {
      // Arrange
      setupModelParameterRulesMock({ data: [], isPending: false })
      const props = createDefaultProps({ provider: 'langgenius/azure_openai/azure_openai' })

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('presets-parameter')).toBeInTheDocument()
    })

    it('should not render PresetsParameter for non-preset providers', () => {
      // Arrange
      setupModelParameterRulesMock({ data: [], isPending: false })
      const props = createDefaultProps({ provider: 'anthropic/claude' })

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.queryByTestId('presets-parameter')).not.toBeInTheDocument()
    })

    it('should render parameter items when rules are available', () => {
      // Arrange
      const rules = [
        createParameterRule({ name: 'temperature' }),
        createParameterRule({ name: 'top_p', label: { en_US: 'Top P', zh_Hans: 'Top P' } }),
      ]
      setupModelParameterRulesMock({ data: rules, isPending: false })
      const props = createDefaultProps()

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('parameter-item-temperature')).toBeInTheDocument()
      expect(screen.getByTestId('parameter-item-top_p')).toBeInTheDocument()
    })

    it('should not render parameter items when rules are empty', () => {
      // Arrange
      setupModelParameterRulesMock({ data: [], isPending: false })
      const props = createDefaultProps()

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.queryByTestId('parameter-item-temperature')).not.toBeInTheDocument()
    })

    it('should include stop parameter rule in advanced mode', () => {
      // Arrange
      const rules = [createParameterRule({ name: 'temperature' })]
      setupModelParameterRulesMock({ data: rules, isPending: false })
      const props = createDefaultProps({ isAdvancedMode: true })

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('parameter-item-temperature')).toBeInTheDocument()
      expect(screen.getByTestId('parameter-item-stop')).toBeInTheDocument()
    })

    it('should not include stop parameter rule in non-advanced mode', () => {
      // Arrange
      const rules = [createParameterRule({ name: 'temperature' })]
      setupModelParameterRulesMock({ data: rules, isPending: false })
      const props = createDefaultProps({ isAdvancedMode: false })

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('parameter-item-temperature')).toBeInTheDocument()
      expect(screen.queryByTestId('parameter-item-stop')).not.toBeInTheDocument()
    })

    it('should pass isInWorkflow=true to ParameterItem', () => {
      // Arrange
      const rules = [createParameterRule({ name: 'temperature' })]
      setupModelParameterRulesMock({ data: rules, isPending: false })
      const props = createDefaultProps()

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('parameter-item-temperature')).toHaveAttribute('data-is-in-workflow', 'true')
    })
  })

  // ==================== Props Testing ====================
  describe('Props', () => {
    it('should call useModelParameterRules with provider and modelId', () => {
      // Arrange
      const props = createDefaultProps({
        provider: 'test-provider',
        modelId: 'test-model',
      })

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(mockUseModelParameterRules).toHaveBeenCalledWith('test-provider', 'test-model')
    })

    it('should pass completion params value to ParameterItem', () => {
      // Arrange
      const rules = [createParameterRule({ name: 'temperature' })]
      setupModelParameterRulesMock({ data: rules, isPending: false })
      const props = createDefaultProps({
        completionParams: { temperature: 0.8 },
      })

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('parameter-item-temperature')).toHaveAttribute('data-value', '0.8')
    })

    it('should handle undefined completion params value', () => {
      // Arrange
      const rules = [createParameterRule({ name: 'temperature' })]
      setupModelParameterRulesMock({ data: rules, isPending: false })
      const props = createDefaultProps({
        completionParams: {},
      })

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert - when value is undefined, JSON.stringify returns undefined string
      expect(screen.getByTestId('parameter-item-temperature')).not.toHaveAttribute('data-value')
    })
  })

  // ==================== Event Handlers ====================
  describe('Event Handlers', () => {
    describe('handleSelectPresetParameter', () => {
      it('should apply Creative preset config', () => {
        // Arrange
        const onCompletionParamsChange = vi.fn()
        setupModelParameterRulesMock({ data: [], isPending: false })
        const props = createDefaultProps({
          provider: 'langgenius/openai/openai',
          onCompletionParamsChange,
          completionParams: { existing: 'value' },
        })

        // Act
        render(<LLMParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('preset-creative'))

        // Assert
        expect(onCompletionParamsChange).toHaveBeenCalledWith({
          existing: 'value',
          temperature: 0.8,
          top_p: 0.9,
          presence_penalty: 0.1,
          frequency_penalty: 0.1,
        })
      })

      it('should apply Balanced preset config', () => {
        // Arrange
        const onCompletionParamsChange = vi.fn()
        setupModelParameterRulesMock({ data: [], isPending: false })
        const props = createDefaultProps({
          provider: 'langgenius/openai/openai',
          onCompletionParamsChange,
          completionParams: {},
        })

        // Act
        render(<LLMParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('preset-balanced'))

        // Assert
        expect(onCompletionParamsChange).toHaveBeenCalledWith({
          temperature: 0.5,
          top_p: 0.85,
          presence_penalty: 0.2,
          frequency_penalty: 0.3,
        })
      })

      it('should apply Precise preset config', () => {
        // Arrange
        const onCompletionParamsChange = vi.fn()
        setupModelParameterRulesMock({ data: [], isPending: false })
        const props = createDefaultProps({
          provider: 'langgenius/openai/openai',
          onCompletionParamsChange,
          completionParams: {},
        })

        // Act
        render(<LLMParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('preset-precise'))

        // Assert
        expect(onCompletionParamsChange).toHaveBeenCalledWith({
          temperature: 0.2,
          top_p: 0.75,
          presence_penalty: 0.5,
          frequency_penalty: 0.5,
        })
      })

      it('should apply empty config for Custom preset (spreads undefined)', () => {
        // Arrange
        const onCompletionParamsChange = vi.fn()
        setupModelParameterRulesMock({ data: [], isPending: false })
        const props = createDefaultProps({
          provider: 'langgenius/openai/openai',
          onCompletionParamsChange,
          completionParams: { existing: 'value' },
        })

        // Act
        render(<LLMParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('preset-custom'))

        // Assert - Custom preset has no config, so only existing params are kept
        expect(onCompletionParamsChange).toHaveBeenCalledWith({ existing: 'value' })
      })
    })

    describe('handleParamChange', () => {
      it('should call onCompletionParamsChange with updated param', () => {
        // Arrange
        const onCompletionParamsChange = vi.fn()
        const rules = [createParameterRule({ name: 'temperature' })]
        setupModelParameterRulesMock({ data: rules, isPending: false })
        const props = createDefaultProps({
          onCompletionParamsChange,
          completionParams: { existing: 'value' },
        })

        // Act
        render(<LLMParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('change-temperature'))

        // Assert
        expect(onCompletionParamsChange).toHaveBeenCalledWith({
          existing: 'value',
          temperature: 0.5,
        })
      })

      it('should override existing param value', () => {
        // Arrange
        const onCompletionParamsChange = vi.fn()
        const rules = [createParameterRule({ name: 'temperature' })]
        setupModelParameterRulesMock({ data: rules, isPending: false })
        const props = createDefaultProps({
          onCompletionParamsChange,
          completionParams: { temperature: 0.9 },
        })

        // Act
        render(<LLMParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('change-temperature'))

        // Assert
        expect(onCompletionParamsChange).toHaveBeenCalledWith({
          temperature: 0.5,
        })
      })
    })

    describe('handleSwitch', () => {
      it('should add param when switch is turned on', () => {
        // Arrange
        const onCompletionParamsChange = vi.fn()
        const rules = [createParameterRule({ name: 'temperature', default: 0.7 })]
        setupModelParameterRulesMock({ data: rules, isPending: false })
        const props = createDefaultProps({
          onCompletionParamsChange,
          completionParams: { existing: 'value' },
        })

        // Act
        render(<LLMParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('switch-on-temperature'))

        // Assert
        expect(onCompletionParamsChange).toHaveBeenCalledWith({
          existing: 'value',
          temperature: 0.7,
        })
      })

      it('should remove param when switch is turned off', () => {
        // Arrange
        const onCompletionParamsChange = vi.fn()
        const rules = [createParameterRule({ name: 'temperature' })]
        setupModelParameterRulesMock({ data: rules, isPending: false })
        const props = createDefaultProps({
          onCompletionParamsChange,
          completionParams: { temperature: 0.8, other: 'value' },
        })

        // Act
        render(<LLMParamsPanel {...props} />)
        fireEvent.click(screen.getByTestId('switch-off-temperature'))

        // Assert
        expect(onCompletionParamsChange).toHaveBeenCalledWith({
          other: 'value',
        })
      })
    })
  })

  // ==================== Memoization ====================
  describe('Memoization - parameterRules', () => {
    it('should return empty array when data is undefined', () => {
      // Arrange
      mockUseModelParameterRules.mockReturnValue({
        data: undefined,
        isPending: false,
      })
      const props = createDefaultProps()

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert - no parameter items should be rendered
      expect(screen.queryByTestId(/parameter-item-/)).not.toBeInTheDocument()
    })

    it('should return empty array when data.data is undefined', () => {
      // Arrange
      mockUseModelParameterRules.mockReturnValue({
        data: { data: undefined },
        isPending: false,
      })
      const props = createDefaultProps()

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.queryByTestId(/parameter-item-/)).not.toBeInTheDocument()
    })

    it('should use data.data when available', () => {
      // Arrange
      const rules = [
        createParameterRule({ name: 'temperature' }),
        createParameterRule({ name: 'top_p' }),
      ]
      setupModelParameterRulesMock({ data: rules, isPending: false })
      const props = createDefaultProps()

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('parameter-item-temperature')).toBeInTheDocument()
      expect(screen.getByTestId('parameter-item-top_p')).toBeInTheDocument()
    })
  })

  // ==================== Edge Cases ====================
  describe('Edge Cases', () => {
    it('should handle empty completionParams', () => {
      // Arrange
      const rules = [createParameterRule({ name: 'temperature' })]
      setupModelParameterRulesMock({ data: rules, isPending: false })
      const props = createDefaultProps({ completionParams: {} })

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('parameter-item-temperature')).toBeInTheDocument()
    })

    it('should handle multiple parameter rules', () => {
      // Arrange
      const rules = [
        createParameterRule({ name: 'temperature' }),
        createParameterRule({ name: 'top_p' }),
        createParameterRule({ name: 'max_tokens', type: 'int' }),
        createParameterRule({ name: 'presence_penalty' }),
      ]
      setupModelParameterRulesMock({ data: rules, isPending: false })
      const props = createDefaultProps()

      // Act
      render(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('parameter-item-temperature')).toBeInTheDocument()
      expect(screen.getByTestId('parameter-item-top_p')).toBeInTheDocument()
      expect(screen.getByTestId('parameter-item-max_tokens')).toBeInTheDocument()
      expect(screen.getByTestId('parameter-item-presence_penalty')).toBeInTheDocument()
    })

    it('should use unique keys for parameter items based on modelId and name', () => {
      // Arrange
      const rules = [
        createParameterRule({ name: 'temperature' }),
        createParameterRule({ name: 'top_p' }),
      ]
      setupModelParameterRulesMock({ data: rules, isPending: false })
      const props = createDefaultProps({ modelId: 'gpt-4' })

      // Act
      const { container } = render(<LLMParamsPanel {...props} />)

      // Assert - verify both items are rendered (keys are internal but rendering proves uniqueness)
      const items = container.querySelectorAll('[data-testid^="parameter-item-"]')
      expect(items).toHaveLength(2)
    })
  })

  // ==================== Re-render Behavior ====================
  describe('Re-render Behavior', () => {
    it('should update parameter items when rules change', () => {
      // Arrange
      const initialRules = [createParameterRule({ name: 'temperature' })]
      setupModelParameterRulesMock({ data: initialRules, isPending: false })
      const props = createDefaultProps()

      // Act
      const { rerender } = render(<LLMParamsPanel {...props} />)
      expect(screen.getByTestId('parameter-item-temperature')).toBeInTheDocument()
      expect(screen.queryByTestId('parameter-item-top_p')).not.toBeInTheDocument()

      // Update mock
      const newRules = [
        createParameterRule({ name: 'temperature' }),
        createParameterRule({ name: 'top_p' }),
      ]
      setupModelParameterRulesMock({ data: newRules, isPending: false })
      rerender(<LLMParamsPanel {...props} />)

      // Assert
      expect(screen.getByTestId('parameter-item-temperature')).toBeInTheDocument()
      expect(screen.getByTestId('parameter-item-top_p')).toBeInTheDocument()
    })

    it('should show loading when transitioning from loaded to loading', () => {
      // Arrange
      const rules = [createParameterRule({ name: 'temperature' })]
      setupModelParameterRulesMock({ data: rules, isPending: false })
      const props = createDefaultProps()

      // Act
      const { rerender } = render(<LLMParamsPanel {...props} />)
      expect(screen.getByTestId('parameter-item-temperature')).toBeInTheDocument()

      // Update to loading
      setupModelParameterRulesMock({ isPending: true })
      rerender(<LLMParamsPanel {...props} />)

      // Assert - Loading component uses role="status" with aria-label
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should update when isAdvancedMode changes', () => {
      // Arrange
      const rules = [createParameterRule({ name: 'temperature' })]
      setupModelParameterRulesMock({ data: rules, isPending: false })
      const props = createDefaultProps({ isAdvancedMode: false })

      // Act
      const { rerender } = render(<LLMParamsPanel {...props} />)
      expect(screen.queryByTestId('parameter-item-stop')).not.toBeInTheDocument()

      rerender(<LLMParamsPanel {...props} isAdvancedMode={true} />)

      // Assert
      expect(screen.getByTestId('parameter-item-stop')).toBeInTheDocument()
    })
  })

  // ==================== Component Type ====================
  describe('Component Type', () => {
    it('should be a functional component', () => {
      // Assert
      expect(typeof LLMParamsPanel).toBe('function')
    })

    it('should accept all required props', () => {
      // Arrange
      setupModelParameterRulesMock({ data: [], isPending: false })
      const props = createDefaultProps()

      // Act & Assert
      expect(() => render(<LLMParamsPanel {...props} />)).not.toThrow()
    })
  })
})
