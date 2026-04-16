/* eslint-disable ts/no-explicit-any */
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { INSERT_VARIABLE_VALUE_BLOCK_COMMAND } from '@/app/components/base/prompt-editor/plugins/variable-block'
import ConfigContext from '@/context/debug-configuration'
import { AppModeEnum } from '@/types/app'
import Prompt from '../simple-prompt-input'

const mockEmit = vi.fn()
const mockSetFeatures = vi.fn()
const mockSetShowExternalDataToolModal = vi.fn()
const mockSetModelConfig = vi.fn()
const mockSetPrevPromptConfig = vi.fn()
const mockSetIntroduction = vi.fn()
const mockOnChange = vi.fn()
const mockToastError = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  __esModule: true,
  default: () => 'desktop',
  MediaType: {
    mobile: 'mobile',
  },
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeaturesStore: () => ({
    getState: () => ({
      features: {
        opening: {
          enabled: false,
          opening_statement: '',
        },
      },
      setFeatures: mockSetFeatures,
    }),
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: (...args: unknown[]) => mockEmit(...args),
    },
  }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalDataToolModal: mockSetShowExternalDataToolModal,
  }),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/app/components/app/configuration/config/automatic/automatic-btn', () => ({
  default: ({ onClick }: { onClick: () => void }) => <button onClick={onClick}>automatic-btn</button>,
}))

vi.mock('@/app/components/app/configuration/config/automatic/get-automatic-res', () => ({
  default: ({ onFinished }: { onFinished: (value: Record<string, unknown>) => void }) => (
    <button onClick={() => onFinished({ modified: 'auto prompt', variables: ['city'], opening_statement: 'hello there' })}>
      finish-automatic
    </button>
  ),
}))

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: {
    onBlur: () => void
    onChange: (value: string) => void
    contextBlock: { datasets: Array<{ id: string, name: string, type: string }> }
    variableBlock: { variables: Array<{ name: string, value: string }> }
    queryBlock: { selectable: boolean }
    externalToolBlock: {
      onAddExternalTool: () => void
      externalTools: Array<{ name: string, variableName: string }>
    }
  }) => (
    <div>
      <div>{`datasets:${props.contextBlock.datasets.map(item => item.name).join(',')}`}</div>
      <div>{`variables:${props.variableBlock.variables.map(item => item.value).join(',')}`}</div>
      <div>{`external-tools:${props.externalToolBlock.externalTools.map(item => item.variableName).join(',')}`}</div>
      <div>{`query-selectable:${String(props.queryBlock.selectable)}`}</div>
      <button onClick={() => props.onChange('Hello {{new_var}}')}>change-prompt</button>
      <button onClick={props.onBlur}>blur-prompt</button>
      <button onClick={props.externalToolBlock.onAddExternalTool}>open-tool-modal</button>
    </div>
  ),
}))

vi.mock('../prompt-editor-height-resize-wrap', () => ({
  default: ({ children, footer }: { children: ReactNode, footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}))

const createContextValue = (overrides: Record<string, unknown> = {}) => ({
  appId: 'app-1',
  modelConfig: {
    configs: {
      prompt_template: 'Hello {{new_var}}',
      prompt_variables: [
        { key: 'existing_var', name: 'Existing', type: 'string', required: true },
      ],
    },
  },
  dataSets: [],
  setModelConfig: mockSetModelConfig,
  setPrevPromptConfig: mockSetPrevPromptConfig,
  setIntroduction: mockSetIntroduction,
  hasSetBlockStatus: {
    context: false,
    history: false,
    query: false,
  },
  showSelectDataSet: vi.fn(),
  externalDataToolsConfig: [],
  ...overrides,
}) as any

describe('SimplePromptInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should prompt to add new variables discovered from the prompt template', () => {
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <Prompt
          mode={AppModeEnum.CHAT}
          promptTemplate="Hello {{new_var}}"
          promptVariables={[]}
          onChange={mockOnChange}
        />
      </ConfigContext.Provider>,
    )

    fireEvent.click(screen.getByText('blur-prompt'))

    expect(screen.getByText('autoAddVar'))!.toBeInTheDocument()

    fireEvent.click(screen.getByText('operation.add'))

    expect(mockOnChange).toHaveBeenCalledWith('Hello {{new_var}}', [
      expect.objectContaining({
        key: 'new_var',
        name: 'new_var',
      }),
    ])
  })

  it('should open the external data tool modal and emit insert events after save', () => {
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <Prompt
          mode={AppModeEnum.CHAT}
          promptTemplate="Hello"
          promptVariables={[
            { key: 'existing_var', name: 'Existing', type: 'string', required: true },
          ]}
          onChange={mockOnChange}
        />
      </ConfigContext.Provider>,
    )

    fireEvent.click(screen.getByText('open-tool-modal'))

    expect(mockSetShowExternalDataToolModal).toHaveBeenCalledTimes(1)
    const modalConfig = mockSetShowExternalDataToolModal.mock.calls[0]![0]

    expect(modalConfig.onValidateBeforeSaveCallback({ variable: 'existing_var' })).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('varKeyError.keyAlreadyExists')
    expect(modalConfig.onValidateBeforeSaveCallback({ variable: 'fresh_var' })).toBe(true)

    modalConfig.onSaveCallback(undefined)
    expect(mockEmit).not.toHaveBeenCalled()

    modalConfig.onSaveCallback({
      label: 'Search',
      variable: 'search_api',
    })

    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ADD_EXTERNAL_DATA_TOOL',
    }))
    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
      payload: 'search_api',
      type: INSERT_VARIABLE_VALUE_BLOCK_COMMAND,
    }))
  })

  it('should apply automatic generation results to prompt and opening statement', () => {
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <Prompt
          mode={AppModeEnum.CHAT}
          promptTemplate="Hello"
          promptVariables={[]}
          onChange={mockOnChange}
        />
      </ConfigContext.Provider>,
    )

    fireEvent.click(screen.getByText('automatic-btn'))
    fireEvent.click(screen.getByText('finish-automatic'))

    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
      payload: 'auto prompt',
      type: 'PROMPT_EDITOR_UPDATE_VALUE_BY_EVENT_EMITTER',
    }))
    expect(mockSetModelConfig).toHaveBeenCalledWith(expect.objectContaining({
      configs: expect.objectContaining({
        prompt_template: 'auto prompt',
        prompt_variables: [
          expect.objectContaining({ key: 'city', name: 'city' }),
        ],
      }),
    }))
    expect(mockSetPrevPromptConfig).toHaveBeenCalled()
    expect(mockSetIntroduction).toHaveBeenCalledWith('hello there')
    expect(mockSetFeatures).toHaveBeenCalled()
  })

  it('should expose dataset and external tool metadata to the editor', () => {
    render(
      <ConfigContext.Provider value={createContextValue({
        dataSets: [{ id: 'dataset-1', name: 'Knowledge Base', data_source_type: 'file' }],
        hasSetBlockStatus: {
          context: false,
          history: false,
          query: true,
        },
        modelConfig: {
          configs: {
            prompt_template: 'Hello {{existing_var}}',
            prompt_variables: [
              { key: 'existing_var', name: 'Existing', type: 'string', required: true },
              { key: 'search_api', name: 'Search API', type: 'api', required: false, icon: 'search', icon_background: '#fff' },
            ],
          },
        },
      })}
      >
        <Prompt
          mode={AppModeEnum.CHAT}
          promptTemplate="Hello {{existing_var}}"
          promptVariables={[
            { key: 'existing_var', name: 'Existing', type: 'string', required: true },
            { key: 'search_api', name: 'Search API', type: 'api', required: false },
          ]}
          onChange={mockOnChange}
        />
      </ConfigContext.Provider>,
    )

    expect(screen.getByText('datasets:Knowledge Base'))!.toBeInTheDocument()
    expect(screen.getByText('variables:existing_var'))!.toBeInTheDocument()
    expect(screen.getByText('external-tools:search_api'))!.toBeInTheDocument()
    expect(screen.getByText('query-selectable:false'))!.toBeInTheDocument()
  })

  it('should skip external tool variables and incomplete prompt variables when deciding whether to auto add', () => {
    render(
      <ConfigContext.Provider value={createContextValue({
        externalDataToolsConfig: [{ variable: 'search_api' }],
      })}
      >
        <Prompt
          mode={AppModeEnum.CHAT}
          promptTemplate="Hello {{search_api}} {{existing_var}}"
          promptVariables={[
            { key: 'existing_var', name: 'Existing', type: 'string', required: true },
          ]}
          onChange={mockOnChange}
        />
      </ConfigContext.Provider>,
    )

    fireEvent.click(screen.getByText('change-prompt'))
    expect(mockOnChange).toHaveBeenCalledWith('Hello {{new_var}}', [])

    fireEvent.click(screen.getByText('blur-prompt'))
    expect(mockOnChange).toHaveBeenLastCalledWith('Hello {{search_api}} {{existing_var}}', [])
  })

  it('should keep invalid prompt variables in the confirmation flow', () => {
    render(
      <ConfigContext.Provider value={createContextValue()}>
        <Prompt
          mode={AppModeEnum.CHAT}
          promptTemplate="Hello {{existing_var}}"
          promptVariables={[
            { key: 'existing_var', name: '', type: 'string', required: true },
          ]}
          onChange={mockOnChange}
        />
      </ConfigContext.Provider>,
    )

    fireEvent.click(screen.getByText('blur-prompt'))
    expect(screen.getByText('autoAddVar'))!.toBeInTheDocument()

    fireEvent.click(screen.getByText('operation.cancel'))
    expect(mockOnChange).toHaveBeenCalledWith('Hello {{existing_var}}', [])
  })
})
