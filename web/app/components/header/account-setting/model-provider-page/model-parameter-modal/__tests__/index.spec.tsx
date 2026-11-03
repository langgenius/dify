import type { FormValue } from '../../declarations'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
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
let modelStatus: 'active' | 'disabled' = 'active'

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    PROVIDER_WITH_PRESET_TONE: ['openai'],
  }
})

const render = createNuqsTestRenderer((ui) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({
          model: 'gpt-3.5-turbo',
          label: { en_US: 'GPT-3.5 Turbo' },
          status: modelStatus,
          model_properties: { mode: 'chat' },
          features: ['vision'],
        }),
        createCatalogModelFixture({
          model: 'gpt-4.1',
          label: { en_US: 'GPT-4.1' },
          model_properties: { mode: 'chat' },
          features: ['vision', 'tool-call'],
        }),
      ],
    }),
  ])
  if (seedRules)
    queryClient.setQueryDefaults(
      consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
      { initialData: { data: parameterRules ?? [] } },
    )
  return renderWithConsoleQuery(ui, { queryClient })
})

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
  const openSettings = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: /modelProvider\.modelSettings/i }))
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
    modelStatus = 'active'
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
    expect(
      screen.getByRole('button', {
        name: /GPT-3.5 Turbo|gpt-3.5-turbo|plugin.detailPanel.configureModel/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toBeInTheDocument()
  })

  it('should keep model selection and model settings as separate actions', async () => {
    const user = userEvent.setup()
    render(<ModelParameterModal {...defaultProps} />)

    expect(
      screen.getByRole('button', {
        name: /GPT-3.5 Turbo|gpt-3.5-turbo|plugin.detailPanel.configureModel/,
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'Temperature' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /GPT-3.5 Turbo/ }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
      ).getByRole('button', { name: /^GPT-4.1/ }),
    )

    expect(defaultProps.setModel).toHaveBeenCalledWith({
      modelId: 'gpt-4.1',
      provider: 'openai',
      plugin_id: 'langgenius/openai',
      mode: 'chat',
      features: ['vision', 'tool-call'],
    })
    expect(screen.queryByRole('spinbutton', { name: 'Temperature' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /modelProvider\.modelSettings/i }))

    expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toBeInTheDocument()
  })

  it('should disable model settings when no model is selected', () => {
    render(<ModelParameterModal {...defaultProps} provider="" modelId="" />)

    expect(
      screen.getByRole('button', {
        name: /GPT-3.5 Turbo|gpt-3.5-turbo|plugin.detailPanel.configureModel/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /modelProvider\.modelSettings/i })).toBeDisabled()
  })

  it('should disable model settings for an incompatible model without disabling selection', () => {
    render(<ModelParameterModal {...defaultProps} modelPredicate={() => false} />)

    expect(
      screen.getByRole('button', {
        name: /GPT-3.5 Turbo|gpt-3.5-turbo|plugin.detailPanel.configureModel/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /modelProvider\.modelSettings/i })).toBeDisabled()
  })

  it('should disable model settings when the selected model is inactive', () => {
    modelStatus = 'disabled'
    render(<ModelParameterModal {...defaultProps} />)

    expect(
      screen.getByRole('button', {
        name: /GPT-3.5 Turbo|gpt-3.5-turbo|plugin.detailPanel.configureModel/,
      }),
    ).toBeInTheDocument()
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
    await openSettings(user)
    await user.clear(screen.getByRole('spinbutton', { name: 'Temperature' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Temperature' }), '0.9')
    expect(defaultProps.onCompletionParamsChange).toHaveBeenLastCalledWith({ temperature: 0.9 })
    await user.click(screen.getByRole('switch', { name: 'Temperature' }))
    expect(defaultProps.onCompletionParamsChange).toHaveBeenLastCalledWith({})
    await user.click(screen.getByRole('switch', { name: 'Temperature' }))
    expect(defaultProps.onCompletionParamsChange).toHaveBeenLastCalledWith({ temperature: 0.9 })
  })

  it('should call onCompletionParamsChange when preset is selected', async () => {
    const user = userEvent.setup()
    render(<ModelParameterModal {...defaultProps} />)
    await openSettings(user)
    await user.click(screen.getByRole('button', { name: /loadPresets/ }))
    await user.click(screen.getByRole('menuitem', { name: /Creative/ }))
    expect(defaultProps.onCompletionParamsChange).toHaveBeenCalledWith({
      ...defaultProps.completionParams,
      temperature: 0.8,
    })
  })

  it('should not render preset control when visible parameters do not support preset keys', async () => {
    const user = userEvent.setup()
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
    await openSettings(user)

    expect(screen.queryByRole('button', { name: /loadPresets/ })).not.toBeInTheDocument()
  })

  it('should toggle debug mode when debug footer is clicked', async () => {
    const user = userEvent.setup()
    render(<ModelParameterModal {...defaultProps} />)
    await openSettings(user)
    await user.click(screen.getByText(/debugAsMultipleModel/i))
    expect(defaultProps.onDebugWithMultipleModelChange).toHaveBeenCalledOnce()
  })

  it('should render loading state when parameter rules are loading', async () => {
    const user = userEvent.setup()
    seedRules = false
    render(<ModelParameterModal {...defaultProps} />)
    await openSettings(user)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('should not render parameter loading when model is not configured and parameter rules query is pending but disabled', async () => {
    const user = userEvent.setup()
    seedRules = false
    parameterRules = []

    render(<ModelParameterModal {...defaultProps} provider="" modelId="" />)
    await openSettings(user)

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(getRules).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', {
        name: /GPT-3.5 Turbo|gpt-3.5-turbo|plugin.detailPanel.configureModel/,
      }),
    ).toBeInTheDocument()
  })

  it('exposes popup state on the settings button and restores focus after Escape', async () => {
    const user = userEvent.setup()
    render(<ModelParameterModal {...defaultProps} />)
    const trigger = screen.getByRole('button', { name: /modelProvider\.modelSettings/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
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
    const user = userEvent.setup()
    parameterRules = undefined
    render(<ModelParameterModal {...defaultProps} />)
    await openSettings(user)
    expect(screen.queryByRole('spinbutton', { name: 'Temperature' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /GPT-3.5 Turbo|gpt-3.5-turbo|plugin.detailPanel.configureModel/,
      }),
    ).toBeInTheDocument()
  })

  it('should support a custom trigger element and missing default model values', async () => {
    const user = userEvent.setup()
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
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByText('Custom Trigger'))

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('button', {
        name: /GPT-3.5 Turbo|gpt-3.5-turbo|plugin.detailPanel.configureModel/,
      }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
      ).getByRole('button', { name: /^GPT-4.1/ }),
    )

    expect(defaultProps.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'gpt-4.1' }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'modelProvider.modelProvider.modelSettings' }),
      ).not.toBeInTheDocument()
    })
  })

  it('should append the stop parameter in advanced mode and show the single-model debug label', async () => {
    const user = userEvent.setup()
    render(<ModelParameterModal {...defaultProps} isAdvancedMode debugWithMultipleModel />)

    await openSettings(user)

    expect(screen.getByText('Stop sequences')).toBeInTheDocument()
    expect(screen.getByText(/debugAsSingleModel/i)).toBeInTheDocument()
  })
})
