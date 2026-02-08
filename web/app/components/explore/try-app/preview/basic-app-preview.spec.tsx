import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BasicAppPreview from './basic-app-preview'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const mockUseGetTryAppInfo = vi.fn()
const mockUseAllToolProviders = vi.fn()
const mockUseGetTryAppDataSets = vi.fn()
const mockUseTextGenerationCurrentProviderAndModelAndModelList = vi.fn()

vi.mock('@/service/use-try-app', () => ({
  useGetTryAppInfo: (...args: unknown[]) => mockUseGetTryAppInfo(...args),
  useGetTryAppDataSets: (...args: unknown[]) => mockUseGetTryAppDataSets(...args),
}))

vi.mock('@/service/use-tools', () => ({
  useAllToolProviders: () => mockUseAllToolProviders(),
}))

vi.mock('../../../header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: (...args: unknown[]) =>
    mockUseTextGenerationCurrentProviderAndModelAndModelList(...args),
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => 'pc',
  MediaType: {
    mobile: 'mobile',
    pc: 'pc',
  },
}))

vi.mock('@/app/components/app/configuration/config', () => ({
  default: () => <div data-testid="config-component">Config</div>,
}))

vi.mock('@/app/components/app/configuration/debug', () => ({
  default: () => <div data-testid="debug-component">Debug</div>,
}))

vi.mock('@/app/components/base/features', () => ({
  FeaturesProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="features-provider">{children}</div>
  ),
}))

const createMockAppDetail = (mode: string = 'chat'): Record<string, unknown> => ({
  id: 'test-app-id',
  name: 'Test App',
  description: 'Test Description',
  mode,
  site: {
    title: 'Test Site Title',
    icon: '🚀',
    icon_type: 'emoji',
    icon_background: '#FFFFFF',
    icon_url: '',
  },
  model_config: {
    model: {
      provider: 'langgenius/openai/openai',
      name: 'gpt-4',
      mode: 'chat',
    },
    pre_prompt: 'You are a helpful assistant',
    user_input_form: [] as unknown[],
    external_data_tools: [] as unknown[],
    dataset_configs: {
      datasets: {
        datasets: [] as unknown[],
      },
    },
    agent_mode: {
      tools: [] as unknown[],
      enabled: false,
    },
    more_like_this: { enabled: false },
    opening_statement: 'Hello!',
    suggested_questions: ['Question 1'],
    sensitive_word_avoidance: null,
    speech_to_text: null,
    text_to_speech: null,
    file_upload: null as unknown,
    suggested_questions_after_answer: null,
    retriever_resource: null,
    annotation_reply: null,
  },
  deleted_tools: [] as unknown[],
})

describe('BasicAppPreview', () => {
  beforeEach(() => {
    mockUseGetTryAppInfo.mockReturnValue({
      data: createMockAppDetail(),
      isLoading: false,
    })
    mockUseAllToolProviders.mockReturnValue({
      data: [],
      isLoading: false,
    })
    mockUseGetTryAppDataSets.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    })
    mockUseTextGenerationCurrentProviderAndModelAndModelList.mockReturnValue({
      currentModel: {
        features: [],
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  describe('loading state', () => {
    it('renders loading when app detail is loading', () => {
      mockUseGetTryAppInfo.mockReturnValue({
        data: null,
        isLoading: true,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('renders loading when tool providers are loading', () => {
      mockUseAllToolProviders.mockReturnValue({
        data: null,
        isLoading: true,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('renders loading when datasets are loading', () => {
      mockUseGetTryAppDataSets.mockReturnValue({
        data: null,
        isLoading: true,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })

  describe('content rendering', () => {
    it('renders Config component when data is loaded', async () => {
      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('config-component')).toBeInTheDocument()
      })
    })

    it('renders Debug component when data is loaded on PC', async () => {
      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('debug-component')).toBeInTheDocument()
      })
    })

    it('renders FeaturesProvider', async () => {
      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('features-provider')).toBeInTheDocument()
      })
    })
  })

  describe('different app modes', () => {
    it('handles chat mode', async () => {
      mockUseGetTryAppInfo.mockReturnValue({
        data: createMockAppDetail('chat'),
        isLoading: false,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('config-component')).toBeInTheDocument()
      })
    })

    it('handles completion mode', async () => {
      mockUseGetTryAppInfo.mockReturnValue({
        data: createMockAppDetail('completion'),
        isLoading: false,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('config-component')).toBeInTheDocument()
      })
    })

    it('handles agent-chat mode', async () => {
      const agentAppDetail = createMockAppDetail('agent-chat')
      const modelConfig = agentAppDetail.model_config as Record<string, unknown>
      modelConfig.agent_mode = {
        tools: [
          {
            provider_id: 'test-provider',
            provider_name: 'test-provider',
            provider_type: 'builtin',
            tool_name: 'test-tool',
            enabled: true,
          },
        ],
        enabled: true,
        max_iteration: 5,
      }

      mockUseGetTryAppInfo.mockReturnValue({
        data: agentAppDetail,
        isLoading: false,
      })

      mockUseAllToolProviders.mockReturnValue({
        data: [
          {
            id: 'test-provider',
            is_team_authorization: true,
            icon: '/icon.png',
          },
        ],
        isLoading: false,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('config-component')).toBeInTheDocument()
      })
    })
  })

  describe('hook calls', () => {
    it('calls useGetTryAppInfo with correct appId', () => {
      render(<BasicAppPreview appId="my-app-id" />)

      expect(mockUseGetTryAppInfo).toHaveBeenCalledWith('my-app-id')
    })

    it('calls useTextGenerationCurrentProviderAndModelAndModelList with model config', async () => {
      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(mockUseTextGenerationCurrentProviderAndModelAndModelList).toHaveBeenCalled()
      })
    })
  })

  describe('model features', () => {
    it('handles vision feature', async () => {
      mockUseTextGenerationCurrentProviderAndModelAndModelList.mockReturnValue({
        currentModel: {
          features: ['vision'],
        },
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('config-component')).toBeInTheDocument()
      })
    })

    it('handles document feature', async () => {
      mockUseTextGenerationCurrentProviderAndModelAndModelList.mockReturnValue({
        currentModel: {
          features: ['document'],
        },
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('config-component')).toBeInTheDocument()
      })
    })

    it('handles audio feature', async () => {
      mockUseTextGenerationCurrentProviderAndModelAndModelList.mockReturnValue({
        currentModel: {
          features: ['audio'],
        },
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('config-component')).toBeInTheDocument()
      })
    })

    it('handles video feature', async () => {
      mockUseTextGenerationCurrentProviderAndModelAndModelList.mockReturnValue({
        currentModel: {
          features: ['video'],
        },
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('config-component')).toBeInTheDocument()
      })
    })
  })

  describe('dataset handling', () => {
    it('handles app with datasets in agent mode', async () => {
      const appWithDatasets = createMockAppDetail('agent-chat')
      const modelConfig = appWithDatasets.model_config as Record<string, unknown>
      modelConfig.agent_mode = {
        tools: [
          {
            dataset: {
              enabled: true,
              id: 'dataset-1',
            },
          },
        ],
        enabled: true,
      }

      mockUseGetTryAppInfo.mockReturnValue({
        data: appWithDatasets,
        isLoading: false,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(mockUseGetTryAppDataSets).toHaveBeenCalled()
      })
    })

    it('handles app with datasets in dataset_configs', async () => {
      const appWithDatasets = createMockAppDetail('chat')
      const modelConfig = appWithDatasets.model_config as Record<string, unknown>
      modelConfig.dataset_configs = {
        datasets: {
          datasets: [
            { dataset: { id: 'dataset-1' } },
            { dataset: { id: 'dataset-2' } },
          ],
        },
      }

      mockUseGetTryAppInfo.mockReturnValue({
        data: appWithDatasets,
        isLoading: false,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(mockUseGetTryAppDataSets).toHaveBeenCalled()
      })
    })
  })

  describe('advanced prompt mode', () => {
    it('handles advanced prompt mode', async () => {
      const appWithAdvancedPrompt = createMockAppDetail('chat')
      const modelConfig = appWithAdvancedPrompt.model_config as Record<string, unknown>
      modelConfig.prompt_type = 'advanced'
      modelConfig.chat_prompt_config = {
        prompt: [{ role: 'system', text: 'You are helpful' }],
      }

      mockUseGetTryAppInfo.mockReturnValue({
        data: appWithAdvancedPrompt,
        isLoading: false,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('config-component')).toBeInTheDocument()
      })
    })
  })

  describe('file upload config', () => {
    it('handles file upload config', async () => {
      const appWithFileUpload = createMockAppDetail('chat')
      const modelConfig = appWithFileUpload.model_config as Record<string, unknown>
      modelConfig.file_upload = {
        enabled: true,
        image: {
          enabled: true,
          detail: 'high',
          number_limits: 5,
          transfer_methods: ['local_file', 'remote_url'],
        },
        allowed_file_types: ['image'],
        allowed_file_extensions: ['.jpg', '.png'],
        allowed_file_upload_methods: ['local_file'],
        number_limits: 3,
      }

      mockUseGetTryAppInfo.mockReturnValue({
        data: appWithFileUpload,
        isLoading: false,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('config-component')).toBeInTheDocument()
      })
    })
  })

  describe('external data tools', () => {
    it('handles app with external_data_tools', async () => {
      const appWithExternalTools = createMockAppDetail('chat')
      const modelConfig = appWithExternalTools.model_config as Record<string, unknown>
      modelConfig.external_data_tools = [
        {
          variable: 'test_var',
          label: 'Test Label',
          enabled: true,
          type: 'text',
          config: {},
          icon: '/icon.png',
          icon_background: '#FFFFFF',
        },
      ]

      mockUseGetTryAppInfo.mockReturnValue({
        data: appWithExternalTools,
        isLoading: false,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('config-component')).toBeInTheDocument()
      })
    })
  })

  describe('deleted tools handling', () => {
    it('handles app with deleted tools', async () => {
      const agentAppDetail = createMockAppDetail('agent-chat')
      const modelConfig = agentAppDetail.model_config as Record<string, unknown>
      modelConfig.agent_mode = {
        tools: [
          {
            id: 'tool-1',
            provider_id: 'test-provider',
            provider_name: 'test-provider',
            provider_type: 'builtin',
            tool_name: 'test-tool',
            enabled: true,
          },
        ],
        enabled: true,
        max_iteration: 5,
      }
      agentAppDetail.deleted_tools = [
        {
          id: 'tool-1',
          tool_name: 'test-tool',
        },
      ]

      mockUseGetTryAppInfo.mockReturnValue({
        data: agentAppDetail,
        isLoading: false,
      })

      mockUseAllToolProviders.mockReturnValue({
        data: [
          {
            id: 'test-provider',
            is_team_authorization: false,
            icon: '/icon.png',
          },
        ],
        isLoading: false,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      await waitFor(() => {
        expect(screen.getByTestId('config-component')).toBeInTheDocument()
      })
    })
  })

  describe('edge cases', () => {
    it('handles app without model_config', async () => {
      const appWithoutModelConfig = createMockAppDetail('chat')
      appWithoutModelConfig.model_config = undefined

      mockUseGetTryAppInfo.mockReturnValue({
        data: appWithoutModelConfig,
        isLoading: false,
      })

      render(<BasicAppPreview appId="test-app-id" />)

      // Should still render (with default model config)
      await waitFor(() => {
        expect(mockUseGetTryAppDataSets).toHaveBeenCalled()
      })
    })
  })
})
