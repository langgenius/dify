import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useContext } from 'use-context-selector'
import ConfigContext from '@/context/debug-configuration'
import Configuration from '../index'

type ControllerState = ReturnType<typeof import('../hooks/use-configuration-controller').useConfigurationController>
type ContextValue = ControllerState['contextValue']

const mockUseConfigurationController = vi.fn()
const mockPublish = vi.fn()

let latestDebugPanelProps: Record<string, unknown> | undefined
let latestModalProps: Record<string, unknown> | undefined
let latestFeatures: unknown

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../hooks/use-configuration-controller', () => ({
  useConfigurationController: () => mockUseConfigurationController(),
}))

vi.mock('@/app/components/base/features', () => ({
  FeaturesProvider: ({ children, features }: { children: ReactNode, features: unknown }) => {
    latestFeatures = features
    return <div data-testid="features-provider">{children}</div>
  },
}))

vi.mock('@/context/mitt-context-provider', () => ({
  MittProvider: ({ children }: { children: ReactNode }) => <div data-testid="mitt-provider">{children}</div>,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading">loading</div>,
}))

vi.mock('@/app/components/app/configuration/config', () => ({
  default: function MockConfig() {
    const context = useContext(ConfigContext)
    return <div data-testid="config">{context.modelConfig.model_id}</div>
  },
}))

vi.mock('@/app/components/app/configuration/components/configuration-header-actions', () => ({
  default: ({ publisherProps }: { publisherProps: { publishDisabled: boolean, onPublish: () => void } }) => {
    return (
      <div data-testid="header-actions" data-disabled={String(publisherProps.publishDisabled)}>
        <button type="button" onClick={() => publisherProps.onPublish()}>
          publish
        </button>
      </div>
    )
  },
}))

vi.mock('@/app/components/app/configuration/components/configuration-debug-panel', () => ({
  default: (props: Record<string, unknown>) => {
    latestDebugPanelProps = props
    return <div data-testid="debug-panel">debug-panel</div>
  },
}))

vi.mock('@/app/components/app/configuration/components/configuration-modals', () => ({
  default: (props: { isMobile?: boolean, isShowDebugPanel?: boolean }) => {
    latestModalProps = props
    return <div data-testid="configuration-modals" data-mobile={String(props.isMobile)} />
  },
}))

const createContextValue = (overrides: Partial<ContextValue> = {}): ContextValue => ({
  setPromptMode: vi.fn(async () => {}),
  isAdvancedMode: false,
  modelConfig: {
    provider: 'langgenius/openai/openai',
    model_id: 'gpt-4o-mini',
    mode: 'chat',
    configs: {
      prompt_template: '',
      prompt_variables: [],
    },
    chat_prompt_config: null,
    completion_prompt_config: null,
    more_like_this: null,
    opening_statement: '',
    suggested_questions: [],
    sensitive_word_avoidance: null,
    speech_to_text: null,
    text_to_speech: null,
    file_upload: null,
    suggested_questions_after_answer: null,
    retriever_resource: null,
    annotation_reply: null,
    external_data_tools: [],
    system_parameters: {
      audio_file_size_limit: 0,
      file_size_limit: 0,
      image_file_size_limit: 0,
      video_file_size_limit: 0,
      workflow_file_upload_limit: 0,
    },
    dataSets: [],
    agentConfig: {
      enabled: false,
      strategy: 'react',
      max_iteration: 5,
      tools: [],
    },
  },
  ...overrides,
} as ContextValue)

const createControllerState = (overrides: Partial<ControllerState> = {}): ControllerState => ({
  currentWorkspaceId: 'workspace-id',
  featuresData: {
    opening: { enabled: true, opening_statement: 'hello', suggested_questions: [] },
  },
  contextValue: createContextValue(),
  debugPanelProps: {
    isAPIKeySet: true,
  },
  headerActionsProps: {
    publisherProps: {
      publishDisabled: false,
      onPublish: mockPublish,
      debugWithMultipleModel: false,
    },
  },
  isLoading: false,
  isLoadingCurrentWorkspace: false,
  isMobile: false,
  modalProps: {
    isMobile: false,
  },
  ...overrides,
} as ControllerState)

describe('Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestDebugPanelProps = undefined
    latestModalProps = undefined
    latestFeatures = undefined
    mockUseConfigurationController.mockReturnValue(createControllerState())
  })

  it('should show loading until workspace and detail initialization finish', () => {
    mockUseConfigurationController.mockReturnValue(createControllerState({
      isLoading: true,
    }))

    render(<Configuration />)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
    expect(screen.queryByTestId('config')).not.toBeInTheDocument()
  })

  it('should render initialized desktop configuration and forward publish state', () => {
    const baseState = createControllerState()
    mockUseConfigurationController.mockReturnValue({
      ...baseState,
      contextValue: {
        ...baseState.contextValue,
        isAdvancedMode: true,
        modelConfig: {
          ...baseState.contextValue.modelConfig,
          model_id: 'gpt-4.1',
        },
      },
      headerActionsProps: {
        ...baseState.headerActionsProps,
        publisherProps: {
          ...baseState.headerActionsProps.publisherProps,
          publishDisabled: true,
          onPublish: mockPublish,
          debugWithMultipleModel: true,
        },
      },
    })

    render(<Configuration />)

    expect(screen.getByText('orchestrate')).toBeInTheDocument()
    expect(screen.getByText('promptMode.advanced')).toBeInTheDocument()
    expect(screen.getByTestId('config')).toHaveTextContent('gpt-4.1')
    expect(screen.getByTestId('debug-panel')).toBeInTheDocument()
    expect(screen.getByTestId('header-actions')).toHaveAttribute('data-disabled', 'true')
    expect(latestFeatures).toEqual(expect.objectContaining({
      opening: expect.objectContaining({ enabled: true }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'publish' }))

    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(latestDebugPanelProps).toEqual(expect.objectContaining({
      isAPIKeySet: true,
    }))
  })

  it('should switch to the mobile modal flow without rendering the desktop debug panel', () => {
    const baseState = createControllerState()
    mockUseConfigurationController.mockReturnValue({
      ...baseState,
      isMobile: true,
      modalProps: {
        ...baseState.modalProps,
        isMobile: true,
        isShowDebugPanel: true,
      },
    })

    render(<Configuration />)

    expect(screen.queryByTestId('debug-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('configuration-modals')).toHaveAttribute('data-mobile', 'true')
    expect(latestModalProps).toEqual(expect.objectContaining({
      isShowDebugPanel: true,
      isMobile: true,
    }))
  })
})
