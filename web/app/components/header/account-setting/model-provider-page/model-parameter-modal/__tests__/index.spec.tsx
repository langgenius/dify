import type { FormValue } from '../../declarations'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import ModelParameterModal from '../index'

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
let seedRules = true
const getRules = vi.fn()
let currentProvider: Record<string, unknown> | undefined = {
  provider: 'openai',
  label: { en_US: 'OpenAI' },
}
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

vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks')>()),
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    currentProvider,
    currentModel,
    activeTextGenerationModelList,
  }),
}))

vi.mock('../../model-selector', () => {
  const ModelSelector = ({
    onHide,
    onValueChange,
  }: {
    onHide?: () => void
    onValueChange: (value: { provider: string; model: string; plugin_id?: string }) => void
  }) => (
    <div data-testid="model-selector">
      <button
        onClick={() =>
          onValueChange({
            provider: 'openai',
            model: 'gpt-4.1',
            plugin_id: 'langgenius/openai',
          })
        }
      >
        Select GPT-4.1
      </button>
      {onHide && <button onClick={onHide}>hide</button>}
    </div>
  )

  return {
    ModelSelector,
    SplitModelSelector: ModelSelector,
  }
})

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    PROVIDER_WITH_PRESET_TONE: ['openai'],
  }
})

const render = (ui: React.ReactElement) => {
  const queryClient = createConsoleQueryClient()
  if (seedRules)
    queryClient.setQueryDefaults(
      consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
      { initialData: { data: parameterRules ?? [] } },
    )
  return renderWithConsoleQuery(ui, { queryClient })
}

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': (input) =>
        getRules(input),
    }),
  }
})

describe('ModelParameterModal', () => {
  const openSettings = () =>
    userEvent.setup().click(screen.getByRole('button', { name: /modelProvider\.modelSettings/i }))
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
    seedRules = true
    getRules.mockReturnValue(new Promise(() => {}))
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

  it('should open settings with the visible title as its accessible name', async () => {
    const user = userEvent.setup()
    render(<ModelParameterModal {...defaultProps} />)

    await user.click(
      screen.getByRole('button', { name: 'modelProvider.modelProvider.modelSettings' }),
    )
    expect(
      screen.getByRole('dialog', { name: 'modelProvider.modelProvider.modelSettings' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toBeInTheDocument()
  })

  it('should keep model selection and model settings as separate actions', async () => {
    render(<ModelParameterModal {...defaultProps} />)

    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'Temperature' })).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByText('Select GPT-4.1'))

    expect(defaultProps.setModel).toHaveBeenCalledWith({
      modelId: 'gpt-4.1',
      provider: 'openai',
      plugin_id: 'langgenius/openai',
      mode: 'chat',
      features: ['vision', 'tool-call'],
    })
    expect(screen.queryByRole('spinbutton', { name: 'Temperature' })).not.toBeInTheDocument()

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /modelProvider\.modelSettings/i }))

    expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toBeInTheDocument()
  })

  it('should disable model settings when no model is selected', () => {
    render(<ModelParameterModal {...defaultProps} provider="" modelId="" />)

    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /modelProvider\.modelSettings/i })).toBeDisabled()
  })

  it('should disable model settings for an incompatible model without disabling selection', () => {
    render(<ModelParameterModal {...defaultProps} modelPredicate={() => false} />)

    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /modelProvider\.modelSettings/i })).toBeDisabled()
  })

  it('should disable model settings when the selected model is inactive', () => {
    currentModel = { ...currentModel!, status: 'disabled' }
    render(<ModelParameterModal {...defaultProps} />)

    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /modelProvider\.modelSettings/i })).toBeDisabled()
  })

  it('edits, removes and restores a numeric parameter through the real controls', async () => {
    const user = userEvent.setup()
    const Harness = () => {
      const [params, setParams] = useState<FormValue>({ temperature: 0.7 })
      return (
        <ModelParameterModal
          {...defaultProps}
          completionParams={params}
          onCompletionParamsChange={(next) => {
            defaultProps.onCompletionParamsChange(next)
            setParams(next)
          }}
        />
      )
    }
    render(<Harness />)
    await openSettings()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Temperature' }), {
      target: { value: '0.9' },
    })
    expect(defaultProps.onCompletionParamsChange).toHaveBeenLastCalledWith({ temperature: 0.9 })
    await user.click(screen.getByRole('switch', { name: 'Temperature' }))
    expect(defaultProps.onCompletionParamsChange).toHaveBeenLastCalledWith({})
    await user.click(screen.getByRole('switch', { name: 'Temperature' }))
    expect(defaultProps.onCompletionParamsChange).toHaveBeenLastCalledWith({ temperature: 0.9 })
  })

  it('should call onCompletionParamsChange when preset is selected', async () => {
    render(<ModelParameterModal {...defaultProps} />)
    await openSettings()
    await userEvent.setup().click(screen.getByRole('button', { name: /loadPresets/ }))
    await userEvent.setup().click(screen.getByRole('menuitem', { name: /Creative/ }))
    expect(defaultProps.onCompletionParamsChange).toHaveBeenCalledWith({
      ...defaultProps.completionParams,
      temperature: 0.8,
    })
  })

  it('should not render preset control when visible parameters do not support preset keys', async () => {
    parameterRules = [
      {
        name: 'max_tokens',
        label: { en_US: 'Max Tokens' },
        type: 'int',
        default: 256,
        min: 1,
        max: 4096,
      },
    ]

    render(<ModelParameterModal {...defaultProps} />)
    await openSettings()

    expect(screen.queryByRole('button', { name: /loadPresets/ })).not.toBeInTheDocument()
  })

  it('should toggle debug mode when debug footer is clicked', async () => {
    render(<ModelParameterModal {...defaultProps} />)
    await openSettings()
    await userEvent.setup().click(screen.getByText(/debugAsMultipleModel/i))
    expect(defaultProps.onDebugWithMultipleModelChange).toHaveBeenCalledOnce()
  })

  it('should render loading state when parameter rules are loading', async () => {
    seedRules = false
    render(<ModelParameterModal {...defaultProps} />)
    await openSettings()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('should not render parameter loading when model is not configured and parameter rules query is pending but disabled', async () => {
    seedRules = false
    parameterRules = []

    render(<ModelParameterModal {...defaultProps} provider="" modelId="" />)
    await openSettings()

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(getRules).not.toHaveBeenCalled()
    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
  })

  it('exposes popup state on the settings button and restores focus after Escape', async () => {
    const user = userEvent.setup()
    render(<ModelParameterModal {...defaultProps} />)
    const trigger = screen.getByRole('button', { name: /modelProvider\.modelSettings/i })
    expect(trigger).not.toHaveAttribute('data-popup-open')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('data-popup-open', '')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })
    expect(trigger).toHaveFocus()
  })

  it('should not open content when readonly is true', () => {
    render(<ModelParameterModal {...defaultProps} readonly />)
    expect(screen.getByRole('button', { name: /modelProvider\.modelSettings/i })).toBeDisabled()
    expect(screen.queryByRole('spinbutton', { name: 'Temperature' })).not.toBeInTheDocument()
  })

  it('should render no parameter items when rules are undefined', async () => {
    parameterRules = undefined
    render(<ModelParameterModal {...defaultProps} />)
    await openSettings()
    expect(screen.queryByRole('spinbutton', { name: 'Temperature' })).not.toBeInTheDocument()
    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
  })

  it('should support a custom trigger element and missing default model values', async () => {
    render(
      <ModelParameterModal
        {...defaultProps}
        provider=""
        modelId=""
        isInWorkflow
        trigger={<button type="button">Custom Trigger</button>}
      />,
    )

    const trigger = screen.getByText('Custom Trigger').closest('button')
    expect(trigger).not.toHaveAttribute('data-popup-open')

    await userEvent.setup().click(screen.getByText('Custom Trigger'))

    expect(trigger).toHaveAttribute('data-popup-open', '')
    expect(screen.getByTestId('model-selector')).toBeInTheDocument()

    await userEvent.setup().click(screen.getByText('hide'))

    await waitFor(() => {
      expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    })
  })

  it('should append the stop parameter in advanced mode and show the single-model debug label', async () => {
    render(<ModelParameterModal {...defaultProps} isAdvancedMode debugWithMultipleModel />)

    await openSettings()

    expect(screen.getByText('Stop sequences')).toBeInTheDocument()
    expect(screen.getByText(/debugAsSingleModel/i)).toBeInTheDocument()
  })
})
