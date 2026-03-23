import { fireEvent, render, screen } from '@testing-library/react'
import ModelParameterModal from './index'

let isAPIKeySet = true
let parameterRules: Array<Record<string, unknown>> | undefined = [
  {
    name: 'temperature',
    label: { en_US: 'Temperature' },
    type: 'float',
    default: 0.7,
    min: 0,
    max: 1,
    help: { en_US: 'Control randomness' },
  },
]
let isRulesLoading = false
let currentProvider: Record<string, unknown> | undefined = { provider: 'openai', label: { en_US: 'OpenAI' } }
let currentModel: Record<string, unknown> | undefined = {
  model: 'gpt-3.5-turbo',
  status: 'active',
  model_properties: { mode: 'chat' },
}
let activeTextGenerationModelList: Array<Record<string, unknown>> = [
  {
    provider: 'openai',
    models: [
      {
        model: 'gpt-3.5-turbo',
        model_properties: { mode: 'chat' },
        features: ['vision'],
      },
      {
        model: 'gpt-4.1',
        model_properties: { mode: 'chat' },
        features: ['vision', 'tool-call'],
      },
    ],
  },
]

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    isAPIKeySet,
  }),
}))

vi.mock('@/service/use-common', () => ({
  useModelParameterRules: () => ({
    data: {
      data: parameterRules,
    },
    isPending: isRulesLoading,
  }),
}))

vi.mock('../hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    currentProvider,
    currentModel,
    activeTextGenerationModelList,
  }),
}))

vi.mock('./parameter-item', () => ({
  default: ({ parameterRule, onChange, onSwitch }: {
    parameterRule: { name: string, label: { en_US: string } }
    onChange: (v: number) => void
    onSwitch: (checked: boolean, val: unknown) => void
  }) => (
    <div data-testid={`param-${parameterRule.name}`}>
      {parameterRule.label.en_US}
      <button onClick={() => onChange(0.9)}>Change</button>
      <button onClick={() => onSwitch(false, undefined)}>Remove</button>
      <button onClick={() => onSwitch(true, 'assigned')}>Add</button>
    </div>
  ),
}))

vi.mock('../model-selector', () => ({
  default: ({ onSelect }: { onSelect: (value: { provider: string, model: string }) => void }) => (
    <div data-testid="model-selector">
      <button onClick={() => onSelect({ provider: 'openai', model: 'gpt-4.1' })}>Select GPT-4.1</button>
    </div>
  ),
}))

vi.mock('./presets-parameter', () => ({
  default: ({ onSelect }: { onSelect: (id: number) => void }) => (
    <button onClick={() => onSelect(1)}>Preset 1</button>
  ),
}))

vi.mock('./trigger', () => ({
  default: () => <button>Open Settings</button>,
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    PROVIDER_WITH_PRESET_TONE: ['openai'],
  }
})

describe('ModelParameterModal', () => {
  const defaultProps = {
    isAdvancedMode: false,
    modelId: 'gpt-3.5-turbo',
    provider: 'openai',
    setModel: vi.fn(),
    completionParams: { temperature: 0.7 },
    onCompletionParamsChange: vi.fn(),
    hideDebugWithMultipleModel: false,
    debugWithMultipleModel: false,
    onDebugWithMultipleModelChange: vi.fn(),
    readonly: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    isAPIKeySet = true
    isRulesLoading = false
    parameterRules = [
      {
        name: 'temperature',
        label: { en_US: 'Temperature' },
        type: 'float',
        default: 0.7,
        min: 0,
        max: 1,
        help: { en_US: 'Control randomness' },
      },
    ]
    currentProvider = { provider: 'openai', label: { en_US: 'OpenAI' } }
    currentModel = {
      model: 'gpt-3.5-turbo',
      status: 'active',
      model_properties: { mode: 'chat' },
    }
    activeTextGenerationModelList = [
      {
        provider: 'openai',
        models: [
          {
            model: 'gpt-3.5-turbo',
            model_properties: { mode: 'chat' },
            features: ['vision'],
          },
          {
            model: 'gpt-4.1',
            model_properties: { mode: 'chat' },
            features: ['vision', 'tool-call'],
          },
        ],
      },
    ]
  })

  it('should render trigger and open modal content when trigger is clicked', () => {
    render(<ModelParameterModal {...defaultProps} />)

    fireEvent.click(screen.getByText('Open Settings'))
    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    expect(screen.getByTestId('param-temperature')).toBeInTheDocument()
  })

  it('should call onCompletionParamsChange when parameter changes and switch actions happen', () => {
    render(<ModelParameterModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Open Settings'))

    fireEvent.click(screen.getByText('Change'))
    expect(defaultProps.onCompletionParamsChange).toHaveBeenCalledWith({
      ...defaultProps.completionParams,
      temperature: 0.9,
    })

    fireEvent.click(screen.getByText('Remove'))
    expect(defaultProps.onCompletionParamsChange).toHaveBeenCalledWith({})

    fireEvent.click(screen.getByText('Add'))
    expect(defaultProps.onCompletionParamsChange).toHaveBeenCalledWith({
      ...defaultProps.completionParams,
      temperature: 'assigned',
    })
  })

  it('should call onCompletionParamsChange when preset is selected', () => {
    render(<ModelParameterModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Open Settings'))
    fireEvent.click(screen.getByText('Preset 1'))
    expect(defaultProps.onCompletionParamsChange).toHaveBeenCalled()
  })

  it('should call setModel when model selector picks another model', () => {
    render(<ModelParameterModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Open Settings'))
    fireEvent.click(screen.getByText('Select GPT-4.1'))

    expect(defaultProps.setModel).toHaveBeenCalledWith({
      modelId: 'gpt-4.1',
      provider: 'openai',
      mode: 'chat',
      features: ['vision', 'tool-call'],
    })
  })

  it('should toggle debug mode when debug footer is clicked', () => {
    render(<ModelParameterModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Open Settings'))
    fireEvent.click(screen.getByText(/debugAsMultipleModel/i))
    expect(defaultProps.onDebugWithMultipleModelChange).toHaveBeenCalled()
  })

  it('should render loading state when parameter rules are loading', () => {
    isRulesLoading = true
    render(<ModelParameterModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Open Settings'))
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should not open content when readonly is true', () => {
    render(<ModelParameterModal {...defaultProps} readonly />)
    fireEvent.click(screen.getByText('Open Settings'))
    expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
  })

  it('should render no parameter items when rules are undefined', () => {
    parameterRules = undefined
    render(<ModelParameterModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Open Settings'))
    expect(screen.queryByTestId('param-temperature')).not.toBeInTheDocument()
    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
  })
})
