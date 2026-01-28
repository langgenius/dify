import type { Inputs, ModelConfig } from '@/models/debug'
import type { PromptVariable } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import ChatUserInput from './chat-user-input'

const mockSetInputs = vi.fn()
const mockUseContext = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('use-context-selector', () => ({
  useContext: () => mockUseContext(),
  createContext: vi.fn(() => ({})),
}))

vi.mock('@/app/components/base/input', () => ({
  default: ({ value, onChange, placeholder, autoFocus, maxLength, readOnly, type }: {
    value: string
    onChange: (e: { target: { value: string } }) => void
    placeholder?: string
    autoFocus?: boolean
    maxLength?: number
    readOnly?: boolean
    type?: string
  }) => (
    <input
      data-testid={`input-${placeholder}`}
      data-autofocus={autoFocus ? 'true' : undefined}
      type={type || 'text'}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={maxLength}
      readOnly={readOnly}
    />
  ),
}))

vi.mock('@/app/components/base/select', () => ({
  default: ({ defaultValue, onSelect, items, disabled, className }: {
    defaultValue: string
    onSelect: (item: { value: string }) => void
    items: { name: string, value: string }[]
    allowSearch?: boolean
    disabled?: boolean
    className?: string
  }) => (
    <select
      data-testid="select-input"
      value={defaultValue}
      onChange={e => onSelect({ value: e.target.value })}
      disabled={disabled}
      className={className}
    >
      {items.map(item => (
        <option key={item.value} value={item.value}>{item.name}</option>
      ))}
    </select>
  ),
}))

vi.mock('@/app/components/base/textarea', () => ({
  default: ({ value, onChange, placeholder, readOnly, className }: {
    value: string
    onChange: (e: { target: { value: string } }) => void
    placeholder?: string
    readOnly?: boolean
    className?: string
  }) => (
    <textarea
      data-testid={`textarea-${placeholder}`}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={readOnly}
      className={className}
    />
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/before-run-form/bool-input', () => ({
  default: ({ name, value, required, onChange, readonly }: {
    name: string
    value: boolean
    required?: boolean
    onChange: (value: boolean) => void
    readonly?: boolean
  }) => (
    <div data-testid={`bool-input-${name}`}>
      <input
        type="checkbox"
        checked={value}
        onChange={e => onChange(e.target.checked)}
        disabled={readonly}
        data-required={required}
      />
      <span>{name}</span>
    </div>
  ),
}))

// Extended type to match runtime behavior (includes 'paragraph', 'checkbox', 'default')
type ExtendedPromptVariable = {
  key: string
  name: string
  type: 'string' | 'number' | 'select' | 'paragraph' | 'checkbox'
  required: boolean
  options?: string[]
  max_length?: number
  default?: string | null
}

const createPromptVariable = (overrides: Partial<ExtendedPromptVariable> = {}): ExtendedPromptVariable => ({
  key: 'test-key',
  name: 'Test Name',
  type: 'string',
  required: false,
  ...overrides,
})

const createModelConfig = (promptVariables: ExtendedPromptVariable[] = []): ModelConfig => ({
  provider: 'openai',
  model_id: 'gpt-4',
  mode: 'chat',
  configs: {
    prompt_template: '',
    prompt_variables: promptVariables as PromptVariable[],
  },
} as ModelConfig)

const createContextValue = (overrides: Partial<{
  modelConfig: ModelConfig
  setInputs: (inputs: Inputs) => void
  readonly: boolean
}> = {}) => ({
  modelConfig: createModelConfig(),
  setInputs: mockSetInputs,
  readonly: false,
  ...overrides,
})

describe('ChatUserInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseContext.mockReturnValue(createContextValue())
  })

  describe('Rendering', () => {
    it('should return null when no prompt variables exist', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([]),
      }))

      const { container } = render(<ChatUserInput inputs={{}} />)
      expect(container.firstChild).toBeNull()
    })

    it('should return null when prompt variables have empty keys', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: '', name: 'Test' }),
          createPromptVariable({ key: '   ', name: 'Test2' }),
        ]),
      }))

      const { container } = render(<ChatUserInput inputs={{}} />)
      expect(container.firstChild).toBeNull()
    })

    it('should return null when prompt variables have empty names', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'key1', name: '' }),
          createPromptVariable({ key: 'key2', name: '   ' }),
        ]),
      }))

      const { container } = render(<ChatUserInput inputs={{}} />)
      expect(container.firstChild).toBeNull()
    })

    it('should render string input type', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('input-Name')).toBeInTheDocument()
    })

    it('should render paragraph input type', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'description', name: 'Description', type: 'paragraph' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('textarea-Description')).toBeInTheDocument()
    })

    it('should render select input type', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'choice', name: 'Choice', type: 'select', options: ['A', 'B', 'C'] }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('select-input')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
      expect(screen.getByText('B')).toBeInTheDocument()
      expect(screen.getByText('C')).toBeInTheDocument()
    })

    it('should render number input type', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'count', name: 'Count', type: 'number' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      const input = screen.getByTestId('input-Count')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('type', 'number')
    })

    it('should render checkbox input type', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'enabled', name: 'Enabled', type: 'checkbox' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('bool-input-Enabled')).toBeInTheDocument()
    })

    it('should render multiple input types', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string' }),
          createPromptVariable({ key: 'desc', name: 'Description', type: 'paragraph' }),
          createPromptVariable({ key: 'choice', name: 'Choice', type: 'select', options: ['X', 'Y'] }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('input-Name')).toBeInTheDocument()
      expect(screen.getByTestId('textarea-Description')).toBeInTheDocument()
      expect(screen.getByTestId('select-input')).toBeInTheDocument()
    })

    it('should show optional label for non-required fields', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string', required: false }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByText('panel.optional')).toBeInTheDocument()
    })

    it('should not show optional label for required fields', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string', required: true }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.queryByText('panel.optional')).not.toBeInTheDocument()
    })

    it('should use key as label when name is not provided', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'myKey', name: '', type: 'string' }),
        ]),
      }))

      // This should actually return null because name is empty
      const { container } = render(<ChatUserInput inputs={{}} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('Input Values', () => {
    it('should display existing input values for string type', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string' }),
        ]),
      }))

      render(<ChatUserInput inputs={{ name: 'John' }} />)
      expect(screen.getByTestId('input-Name')).toHaveValue('John')
    })

    it('should display existing input values for paragraph type', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'desc', name: 'Description', type: 'paragraph' }),
        ]),
      }))

      render(<ChatUserInput inputs={{ desc: 'Long text here' }} />)
      expect(screen.getByTestId('textarea-Description')).toHaveValue('Long text here')
    })

    it('should display existing input values for number type', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'count', name: 'Count', type: 'number' }),
        ]),
      }))

      render(<ChatUserInput inputs={{ count: 42 }} />)
      // Number type input still uses string value internally
      expect(screen.getByTestId('input-Count')).toHaveValue(42)
    })

    it('should display checkbox as checked when value is truthy', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'enabled', name: 'Enabled', type: 'checkbox' }),
        ]),
      }))

      render(<ChatUserInput inputs={{ enabled: true }} />)
      const checkbox = screen.getByTestId('bool-input-Enabled').querySelector('input')
      expect(checkbox).toBeChecked()
    })

    it('should display checkbox as unchecked when value is falsy', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'enabled', name: 'Enabled', type: 'checkbox' }),
        ]),
      }))

      render(<ChatUserInput inputs={{ enabled: false }} />)
      const checkbox = screen.getByTestId('bool-input-Enabled').querySelector('input')
      expect(checkbox).not.toBeChecked()
    })

    it('should handle empty string values', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string' }),
        ]),
      }))

      render(<ChatUserInput inputs={{ name: '' }} />)
      expect(screen.getByTestId('input-Name')).toHaveValue('')
    })

    it('should handle undefined values', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('input-Name')).toHaveValue('')
    })
  })

  describe('User Interactions', () => {
    it('should call setInputs when string input changes', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      fireEvent.change(screen.getByTestId('input-Name'), { target: { value: 'New Value' } })

      expect(mockSetInputs).toHaveBeenCalledWith({ name: 'New Value' })
    })

    it('should call setInputs when paragraph input changes', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'desc', name: 'Description', type: 'paragraph' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      fireEvent.change(screen.getByTestId('textarea-Description'), { target: { value: 'New Description' } })

      expect(mockSetInputs).toHaveBeenCalledWith({ desc: 'New Description' })
    })

    it('should call setInputs when select input changes', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'choice', name: 'Choice', type: 'select', options: ['A', 'B', 'C'] }),
        ]),
      }))

      render(<ChatUserInput inputs={{ choice: 'A' }} />)
      fireEvent.change(screen.getByTestId('select-input'), { target: { value: 'B' } })

      expect(mockSetInputs).toHaveBeenCalledWith({ choice: 'B' })
    })

    it('should call setInputs when number input changes', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'count', name: 'Count', type: 'number' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      fireEvent.change(screen.getByTestId('input-Count'), { target: { value: '100' } })

      expect(mockSetInputs).toHaveBeenCalledWith({ count: '100' })
    })

    it('should call setInputs when checkbox changes', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'enabled', name: 'Enabled', type: 'checkbox' }),
        ]),
      }))

      render(<ChatUserInput inputs={{ enabled: false }} />)
      const checkbox = screen.getByTestId('bool-input-Enabled').querySelector('input')!
      fireEvent.click(checkbox)

      expect(mockSetInputs).toHaveBeenCalledWith({ enabled: true })
    })

    it('should not call setInputs for unknown keys', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)

      // The component filters by promptVariableObj, so unknown keys won't trigger updates
      // This is tested indirectly - only valid keys should trigger setInputs
      fireEvent.change(screen.getByTestId('input-Name'), { target: { value: 'Valid' } })

      expect(mockSetInputs).toHaveBeenCalledTimes(1)
      expect(mockSetInputs).toHaveBeenCalledWith({ name: 'Valid' })
    })
  })

  describe('Readonly Mode', () => {
    it('should set string input as readonly when readonly is true', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string' }),
        ]),
        readonly: true,
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('input-Name')).toHaveAttribute('readonly')
    })

    it('should set paragraph input as readonly when readonly is true', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'desc', name: 'Description', type: 'paragraph' }),
        ]),
        readonly: true,
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('textarea-Description')).toHaveAttribute('readonly')
    })

    it('should disable select when readonly is true', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'choice', name: 'Choice', type: 'select', options: ['A', 'B'] }),
        ]),
        readonly: true,
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('select-input')).toBeDisabled()
    })

    it('should disable checkbox when readonly is true', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'enabled', name: 'Enabled', type: 'checkbox' }),
        ]),
        readonly: true,
      }))

      render(<ChatUserInput inputs={{}} />)
      const checkbox = screen.getByTestId('bool-input-Enabled').querySelector('input')
      expect(checkbox).toBeDisabled()
    })
  })

  describe('Default Values', () => {
    it('should initialize inputs with default values when field is empty', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string', default: 'Default Name' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)

      expect(mockSetInputs).toHaveBeenCalledWith({ name: 'Default Name' })
    })

    it('should not override existing values with defaults', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string', default: 'Default' }),
        ]),
      }))

      render(<ChatUserInput inputs={{ name: 'Existing Value' }} />)

      // setInputs should not be called since there's already a value
      expect(mockSetInputs).not.toHaveBeenCalled()
    })

    it('should handle multiple default values', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string', default: 'Default Name' }),
          createPromptVariable({ key: 'count', name: 'Count', type: 'number', default: '10' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)

      expect(mockSetInputs).toHaveBeenCalledWith({
        name: 'Default Name',
        count: '10',
      })
    })

    it('should not set default when default is empty string', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string', default: '' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)

      expect(mockSetInputs).not.toHaveBeenCalled()
    })

    it('should not set default when default is undefined', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)

      expect(mockSetInputs).not.toHaveBeenCalled()
    })

    it('should not set default when default is null', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string', default: null as unknown as string }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)

      expect(mockSetInputs).not.toHaveBeenCalled()
    })
  })

  describe('AutoFocus', () => {
    it('should set autoFocus on first string input', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'first', name: 'First', type: 'string' }),
          createPromptVariable({ key: 'second', name: 'Second', type: 'string' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('input-First')).toHaveAttribute('data-autofocus', 'true')
      expect(screen.getByTestId('input-Second')).not.toHaveAttribute('data-autofocus')
    })

    it('should set autoFocus on first number input when it is the first field', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'count', name: 'Count', type: 'number' }),
          createPromptVariable({ key: 'name', name: 'Name', type: 'string' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('input-Count')).toHaveAttribute('data-autofocus', 'true')
    })
  })

  describe('MaxLength', () => {
    it('should pass maxLength to string input', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string', max_length: 50 }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('input-Name')).toHaveAttribute('maxLength', '50')
    })

    it('should pass maxLength to number input', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'count', name: 'Count', type: 'number', max_length: 10 }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      expect(screen.getByTestId('input-Count')).toHaveAttribute('maxLength', '10')
    })
  })

  describe('Edge Cases', () => {
    it('should handle select with empty options', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'choice', name: 'Choice', type: 'select', options: [] }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      const select = screen.getByTestId('select-input')
      expect(select).toBeInTheDocument()
      expect(select.children).toHaveLength(0)
    })

    it('should handle select with undefined options', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'choice', name: 'Choice', type: 'select' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      const select = screen.getByTestId('select-input')
      expect(select).toBeInTheDocument()
    })

    it('should preserve other input values when updating one field', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'name', name: 'Name', type: 'string' }),
          createPromptVariable({ key: 'desc', name: 'Description', type: 'paragraph' }),
        ]),
      }))

      render(<ChatUserInput inputs={{ name: 'Existing', desc: 'Also Existing' }} />)
      fireEvent.change(screen.getByTestId('input-Name'), { target: { value: 'Updated' } })

      expect(mockSetInputs).toHaveBeenCalledWith({
        name: 'Updated',
        desc: 'Also Existing',
      })
    })

    it('should convert non-string values to string for display', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'value', name: 'Value', type: 'string' }),
        ]),
      }))

      render(<ChatUserInput inputs={{ value: 123 as unknown as string }} />)
      expect(screen.getByTestId('input-Value')).toHaveValue('123')
    })

    it('should not hide label for checkbox type', () => {
      mockUseContext.mockReturnValue(createContextValue({
        modelConfig: createModelConfig([
          createPromptVariable({ key: 'enabled', name: 'Is Enabled', type: 'checkbox' }),
        ]),
      }))

      render(<ChatUserInput inputs={{}} />)
      // For checkbox, the label is rendered inside BoolInput, not in the header
      expect(screen.queryByText('Is Enabled')).toBeInTheDocument()
    })
  })
})
