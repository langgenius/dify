import type { ToolVarInputs } from '../../types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { App } from '@/types/app'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import {
  ConfigurationMethodEnum,
  FormTypeEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarType } from '@/app/components/workflow/types'
import { ProviderContext } from '@/context/provider-context'
import { AppModeEnum } from '@/types/app'
import { VarType as ToolVarType } from '../../types'
import InputVarList from '../input-var-list'

const mockUseAvailableVarList = vi.fn()
const mockFetchNextPage = vi.fn()
const mockApps: App[] = [
  {
    id: 'app-1',
    name: 'Weather Assistant',
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji',
    icon: 'W',
    icon_background: '#FFEAD5',
    model_config: {
      user_input_form: [{
        'text-input': {
          label: 'Topic',
          variable: 'topic',
        },
      }],
    },
  } as App,
]

class MockIntersectionObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  root = null
  rootMargin = ''
  thresholds: number[] = []
  takeRecords = vi.fn().mockReturnValue([])

  constructor(_callback: IntersectionObserverCallback) {}
}

class MockMutationObserver {
  observe = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn().mockReturnValue([])

  constructor(_callback: MutationCallback) {}
}

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
  useModelList: () => ({
    data: [{
      provider: 'openai',
      icon_small: {
        en_US: 'https://example.com/openai.png',
        zh_Hans: 'https://example.com/openai.png',
      },
      label: {
        en_US: 'OpenAI',
        zh_Hans: 'OpenAI',
      },
      models: [{
        model: 'gpt-4o',
        label: {
          en_US: 'GPT-4o',
          zh_Hans: 'GPT-4o',
        },
        model_type: ModelTypeEnum.textGeneration,
        fetch_from: ConfigurationMethodEnum.predefinedModel,
        status: ModelStatusEnum.active,
        model_properties: {
          mode: 'chat',
        },
        load_balancing_enabled: false,
        features: [],
      }],
      status: ModelStatusEnum.active,
    }],
    mutate: vi.fn(),
    isLoading: false,
  }),
  useMarketplaceAllPlugins: () => ({
    plugins: [],
    isLoading: false,
  }),
  useUpdateModelList: () => vi.fn(),
  useUpdateModelProviders: () => vi.fn(),
  useCurrentProviderAndModel: (
    modelList: Array<{
      provider: string
      models: Array<{ model: string }>
    }>,
    defaultModel?: { provider: string, model: string },
  ) => {
    const currentProvider = modelList.find(provider => provider.provider === defaultModel?.provider)
    const currentModel = currentProvider?.models.find(model => model.model === defaultModel?.model)

    return {
      currentProvider,
      currentModel,
    }
  },
}))

vi.mock('@/service/use-apps', () => ({
  useAppDetail: (appId: string) => ({
    data: mockApps.find(app => app.id === appId),
    isFetching: false,
  }),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useInfiniteQuery: () => ({
      data: {
        pages: [{
          data: mockApps,
        }],
      },
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: mockFetchNextPage,
      hasNextPage: false,
    }),
  }
})

vi.mock('@/service/use-workflow', () => ({
  useAppWorkflow: () => ({
    data: undefined,
    isFetching: false,
  }),
}))

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({
    data: {
      image_file_size_limit: 10,
      file_size_limit: 15,
      audio_file_size_limit: 50,
      video_file_size_limit: 100,
      workflow_file_upload_limit: 10,
    },
  }),
  useModelParameterRules: () => ({
    data: {
      data: [],
    },
    isPending: false,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseAvailableVarList(...args),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  default: ({
    value,
    onChange,
    onFocusChange,
    placeholder,
  }: {
    value: string
    onChange: (value: string) => void
    onFocusChange?: (value: boolean) => void
    placeholder?: string
  }) => (
    <input
      aria-label={placeholder || 'mixed-input'}
      value={value}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      onChange={e => onChange(e.target.value)}
    />
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({
    onChange,
    onOpen,
    schema,
    defaultVarKindType,
  }: {
    onChange: (value: string[] | string, kind: ToolVarType) => void
    onOpen?: () => void
    schema?: { variable?: string }
    defaultVarKindType?: ToolVarType
  }) => (
    <button
      type="button"
      onClick={() => {
        onOpen?.()
        if (defaultVarKindType === ToolVarType.variable)
          onChange(['node-1', 'file'], ToolVarType.variable)
        else
          onChange('42', defaultVarKindType || ToolVarType.constant)
      }}
    >
      {`pick-${schema?.variable || 'var'}`}
    </button>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/provider-added-card/use-trial-credits', () => ({
  useTrialCredits: () => ({
    isExhausted: false,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/provider-added-card/use-change-provider-priority', () => ({
  useChangeProviderPriority: () => ({
    isChangingPriority: false,
    handleChangePriority: vi.fn(),
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state', () => ({
  useCredentialPanelState: () => ({
    variant: 'api-active',
    priority: 'apiKeyOnly',
    supportsCredits: false,
    showPrioritySwitcher: false,
    hasCredentials: true,
    isCreditsExhausted: false,
    credentialName: 'Primary key',
    credits: 0,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth/hooks', () => ({
  useCredentialStatus: () => ({
    hasCredential: true,
    authorized: true,
    current_credential_name: 'Primary key',
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/base/check-task-status', () => ({
  default: () => ({
    check: vi.fn(),
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({
    refreshPluginList: vi.fn(),
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  useInstallPackageFromMarketPlace: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/utils/completion-params', () => ({
  fetchAndMergeValidCompletionParams: vi.fn(async () => ({
    params: {},
    removedDetails: {},
  })),
}))

const createSchemaItem = (
  variable: string,
  type: FormTypeEnum,
  overrides: Partial<CredentialFormSchema> = {},
): CredentialFormSchema => ({
  variable,
  name: variable,
  label: {
    en_US: `${variable}-label`,
    zh_Hans: `${variable}-label`,
  },
  type,
  required: false,
  show_on: [],
  ...overrides,
})

type TestHarnessProps = {
  schema: CredentialFormSchema[]
  initialValue?: ToolVarInputs
  onChangeSpy?: (value: ToolVarInputs) => void
  onOpen?: (index: number) => void
}

const TestHarness = ({
  schema,
  initialValue = {},
  onChangeSpy,
  onOpen,
}: TestHarnessProps) => {
  const [value, setValue] = useState<ToolVarInputs>(initialValue)

  return (
    <InputVarList
      readOnly={false}
      nodeId="tool-node"
      schema={schema}
      value={value}
      onChange={(nextValue) => {
        setValue(nextValue)
        onChangeSpy?.(nextValue)
      }}
      onOpen={onOpen}
    />
  )
}

const renderInputVarList = (ui: React.ReactElement) => {
  const providerContextValue = createMockProviderContextValue({
    isAPIKeySet: true,
    modelProviders: [{
      provider: 'openai',
      label: {
        en_US: 'OpenAI',
        zh_Hans: 'OpenAI',
      },
      preferred_provider_type: 'custom',
      configurate_methods: [ConfigurationMethodEnum.predefinedModel],
      supported_model_types: [ModelTypeEnum.textGeneration],
    }] as ReturnType<typeof createMockProviderContextValue>['modelProviders'],
  })

  return renderWithSystemFeatures(
    <ProviderContext.Provider value={providerContextValue}>
      {ui}
    </ProviderContext.Provider>,
  )
}

describe('InputVarList', () => {
  beforeAll(() => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    vi.stubGlobal('MutationObserver', MockMutationObserver)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [{
        nodeId: 'node-1',
        title: 'Node 1',
        vars: [{ variable: 'score', type: VarType.number }],
      }],
      availableNodesWithParent: [],
    })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('should render schema labels and update mixed text inputs', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderInputVarList(
      <TestHarness
        schema={[
          createSchemaItem('query', FormTypeEnum.textInput, {
            required: true,
            tooltip: {
              en_US: 'query-tip',
              zh_Hans: 'query-tip',
            },
          }),
        ]}
        onChangeSpy={onChange}
      />,
    )

    expect(screen.getByText('query-label')).toBeInTheDocument()
    expect(screen.getByText('String')).toBeInTheDocument()
    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(screen.getByText('query-tip')).toBeInTheDocument()

    await user.type(screen.getByLabelText('workflow.nodes.http.insertVarPlaceholder'), 'hello')

    expect(onChange).toHaveBeenLastCalledWith({
      query: {
        type: ToolVarType.mixed,
        value: 'hello',
      },
    })
  })

  it('should transform variable picker selections for number and file fields and report picker openings', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onOpen = vi.fn()

    renderInputVarList(
      <TestHarness
        schema={[
          createSchemaItem('limit', FormTypeEnum.textNumber),
          createSchemaItem('attachment', FormTypeEnum.file),
        ]}
        onOpen={onOpen}
        onChangeSpy={onChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'pick-limit' }))
    await user.click(screen.getByRole('button', { name: 'pick-var' }))

    expect(onOpen).toHaveBeenNthCalledWith(1, 0)
    expect(onOpen).toHaveBeenNthCalledWith(2, 1)
    expect(onChange).toHaveBeenNthCalledWith(1, {
      limit: {
        type: ToolVarType.constant,
        value: '42',
      },
    })
    expect(onChange).toHaveBeenNthCalledWith(2, {
      limit: {
        type: ToolVarType.constant,
        value: '42',
      },
      attachment: {
        type: ToolVarType.variable,
        value: ['node-1', 'file'],
      },
    })
  })

  it('should replace app selections and merge model selections into existing values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderInputVarList(
      <TestHarness
        schema={[
          createSchemaItem('assistant', FormTypeEnum.appSelector),
          createSchemaItem('model', FormTypeEnum.modelSelector, {
            scope: 'llm',
          }),
        ]}
        initialValue={{
          model: {
            credential_id: 'credential-1',
          },
        } as unknown as ToolVarInputs}
        onChangeSpy={onChange}
      />,
    )

    await user.click(screen.getAllByText('app.appSelector.placeholder')[0]!)
    await user.click(screen.getAllByText('app.appSelector.placeholder')[1]!)
    await user.click(screen.getByTitle('Weather Assistant (app-1)'))

    expect(onChange).toHaveBeenNthCalledWith(1, {
      assistant: {
        app_id: 'app-1',
        inputs: {},
        files: [],
      },
      model: {
        credential_id: 'credential-1',
      },
    })

    const topicInput = await screen.findByPlaceholderText('Topic')
    await user.type(topicInput, 'weather')

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith({
        assistant: {
          app_id: 'app-1',
          inputs: { topic: 'weather' },
          files: [],
        },
        model: {
          credential_id: 'credential-1',
        },
      })
    })

    await user.click(screen.getByRole('button', { name: 'app.appSelector.label' }))
    await user.click(screen.getByText('workflow:errorMsg.configureModel'))
    await user.click(await screen.findByRole('combobox', { name: 'plugin.detailPanel.configureModel' }))
    await user.click(await screen.findByRole('option', { name: /GPT-4o/i }))

    expect(onChange).toHaveBeenLastCalledWith({
      assistant: {
        app_id: 'app-1',
        inputs: { topic: 'weather' },
        files: [],
      },
      model: {
        completion_params: {},
        credential_id: 'credential-1',
        mode: 'chat',
        provider: 'openai',
        model: 'gpt-4o',
        model_type: 'llm',
      },
    })
  })
})
