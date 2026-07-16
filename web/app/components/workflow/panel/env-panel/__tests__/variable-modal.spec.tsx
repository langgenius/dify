import type { ReactElement } from 'react'
import type {
  Model,
  ModelItem,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Shape } from '@/app/components/workflow/store/workflow'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import { toast } from '@langgenius/dify-ui/toast'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ConfigurationMethodEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import VariableModal from '../variable-modal'

type MockModelParameterModalProps = {
  provider: string
  modelId: string
  completionParams: Record<string, unknown>
  modelList?: Model[]
  setModel: (model: { provider: string; modelId: string; mode?: string }) => void
  onCompletionParamsChange: (params: Record<string, unknown>) => void
}

let mockTextGenerationModelList: Model[] = []
let latestModelParameterModalProps: MockModelParameterModalProps | undefined

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    currentProvider: undefined,
    currentModel: undefined,
    textGenerationModelList: mockTextGenerationModelList,
    activeTextGenerationModelList: mockTextGenerationModelList,
  }),
}))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: (props: MockModelParameterModalProps) => {
      latestModelParameterModalProps = props

      return (
        <div>
          <div>{props.modelId ? `selected:${props.modelId}` : 'selected:none'}</div>
          {(props.modelList ?? mockTextGenerationModelList).flatMap((provider) =>
            provider.models.map((model) => (
              <button
                key={`${provider.provider}:${model.model}`}
                type="button"
                onClick={() =>
                  props.setModel({
                    provider: provider.provider,
                    modelId: model.model,
                    mode: model.model_properties.mode as string,
                  })
                }
              >
                {model.model}
              </button>
            )),
          )}
          <button
            type="button"
            onClick={() =>
              props.onCompletionParamsChange({ ...props.completionParams, temperature: 0.4 })
            }
          >
            Set temperature
          </button>
        </div>
      )
    },
  }),
)

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

const mockToastError = vi.mocked(toast.error)

const createModelItem = (model: string, mode: string): ModelItem => ({
  model,
  label: { en_US: model, zh_Hans: model },
  model_type: ModelTypeEnum.textGeneration,
  features: [],
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: { mode },
  load_balancing_enabled: false,
})

const createModelProvider = (): Model => ({
  provider: 'openai',
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [
    createModelItem('chat-model', 'chat'),
    createModelItem('completion-model', 'completion'),
  ],
  status: ModelStatusEnum.active,
})

const createEnv = (overrides: Partial<EnvironmentVariable> = {}): EnvironmentVariable => ({
  id: 'env-1',
  name: 'api_key',
  value: '[__HIDDEN__]',
  value_type: 'secret',
  description: 'secret description',
  ...overrides,
})

const renderWithProviders = (
  ui: ReactElement,
  options: {
    storeState?: Partial<Shape>
  } = {},
) => {
  const store = createWorkflowStore({})

  if (options.storeState) store.setState(options.storeState)

  const result = render(<WorkflowContext value={store}>{ui}</WorkflowContext>)

  return {
    ...result,
    store,
  }
}

describe('VariableModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTextGenerationModelList = [createModelProvider()]
    latestModelParameterModalProps = undefined
  })

  it('creates a secret environment variable and normalizes spaces in its name', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()

    renderWithProviders(<VariableModal onClose={onClose} onSave={onSave} />, {
      storeState: {
        environmentVariables: [],
      },
    })

    await user.click(screen.getByText('Secret'))
    await user.type(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'), 'my secret')
    await user.type(
      screen.getByPlaceholderText('workflow.env.modal.valuePlaceholder'),
      'top-secret',
    )
    await user.type(
      screen.getByPlaceholderText('workflow.env.modal.descriptionPlaceholder'),
      'runtime only',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder')).toHaveValue(
      'my_secret',
    )
    expect(onSave).toHaveBeenCalledWith({
      id: expect.any(String),
      name: 'my_secret',
      value: 'top-secret',
      value_type: 'secret',
      description: 'runtime only',
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid and duplicate variable names', async () => {
    const user = userEvent.setup()
    renderWithProviders(<VariableModal onClose={vi.fn()} onSave={vi.fn()} />, {
      storeState: {
        environmentVariables: [
          createEnv({ id: 'env-existing', name: 'duplicated', value_type: 'string', value: '1' }),
        ],
      },
    })

    fireEvent.change(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'), {
      target: { value: '1bad' },
    })
    expect(mockToastError).toHaveBeenCalled()

    mockToastError.mockClear()
    await user.clear(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'))
    await user.type(screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'), 'duplicated')
    await user.type(screen.getByPlaceholderText('workflow.env.modal.valuePlaceholder'), '42')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(mockToastError).toHaveBeenCalledWith(
      'appDebug.varKeyError.keyAlreadyExists:{"key":"workflow.env.modal.name"}',
    )
  })

  it('loads existing secret values and converts them to numbers when editing', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    renderWithProviders(
      <VariableModal
        env={createEnv({
          id: 'env-2',
          name: 'counter',
          value: '[__HIDDEN__]',
          description: 'editable',
        })}
        onClose={vi.fn()}
        onSave={onSave}
      />,
      {
        storeState: {
          environmentVariables: [createEnv({ id: 'env-2', name: 'counter' })],
          envSecrets: { 'env-2': '123' },
        },
      },
    )

    expect(screen.getByDisplayValue('counter')).toBeInTheDocument()
    expect(screen.getByDisplayValue('123')).toBeInTheDocument()

    await user.click(screen.getByText('Number'))
    const valueInput = screen.getByPlaceholderText('workflow.env.modal.valuePlaceholder')
    await user.clear(valueInput)
    await user.type(valueInput, '9')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onSave).toHaveBeenCalledWith({
      id: 'env-2',
      name: 'counter',
      value: 9,
      value_type: 'number',
      description: 'editable',
    })
  })

  it('creates an LLM environment variable from the selected text-generation model', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    renderWithProviders(<VariableModal onClose={vi.fn()} onSave={onSave} />, {
      storeState: {
        environmentVariables: [],
      },
    })

    await user.click(screen.getByRole('button', { name: 'workflow.blocks.llm' }))
    await user.type(
      screen.getByPlaceholderText('workflow.env.modal.namePlaceholder'),
      'for_summarize',
    )
    await user.click(screen.getByRole('button', { name: 'chat-model' }))
    await user.click(screen.getByRole('button', { name: 'Set temperature' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(onSave).toHaveBeenCalledWith({
      id: expect.any(String),
      name: 'for_summarize',
      value: {
        provider: 'openai',
        name: 'chat-model',
        mode: 'chat',
        completion_params: { temperature: 0.4 },
      },
      value_type: 'llm',
      description: '',
    })
  })

  it('keeps an edited LLM environment variable within its existing model mode', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const env = createEnv({
      id: 'env-llm',
      name: 'for_research',
      value: { provider: 'openai', name: 'chat-model', mode: 'chat' },
      value_type: 'llm',
      description: 'research model',
    })

    renderWithProviders(<VariableModal env={env} onClose={vi.fn()} onSave={onSave} />, {
      storeState: {
        environmentVariables: [env],
      },
    })

    expect(screen.getByText('selected:chat-model')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'chat-model' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'completion-model' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'String' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Number' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Secret' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'workflow.blocks.llm' })).toBeEnabled()

    act(() => {
      latestModelParameterModalProps?.setModel({
        provider: 'openai',
        modelId: 'completion-model',
        mode: 'completion',
      })
    })
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(mockToastError).toHaveBeenCalledWith('common.modelProvider.selector.incompatibleTip')
    expect(onSave).toHaveBeenCalledWith(env)
  })
})
