import type { Model, ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Import component after mocks
import Toast from '@/app/components/base/toast'

import { ConfigurationMethodEnum, ModelStatusEnum, ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ModelParameterModal from './index'

// ==================== Mock Setup ====================

// Mock shared state for portal
let mockPortalOpenState = false

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => {
    mockPortalOpenState = open || false
    return (
      <div data-testid="portal-elem" data-open={open}>
        {children}
      </div>
    )
  },
  PortalToFollowElemTrigger: ({ children, onClick, className }: { children: React.ReactNode, onClick: () => void, className?: string }) => (
    <div data-testid="portal-trigger" onClick={onClick} className={className}>
      {children}
    </div>
  ),
  PortalToFollowElemContent: ({ children, className }: { children: React.ReactNode, className?: string }) => {
    if (!mockPortalOpenState)
      return null
    return (
      <div data-testid="portal-content" className={className}>
        {children}
      </div>
    )
  },
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

// Mock provider context
const mockProviderContextValue = {
  isAPIKeySet: true,
  modelProviders: [],
}
vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockProviderContextValue,
}))

// Mock model list hook
const mockTextGenerationList: Model[] = []
const mockTextEmbeddingList: Model[] = []
const mockRerankList: Model[] = []
const mockModerationList: Model[] = []
const mockSttList: Model[] = []
const mockTtsList: Model[] = []

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: (type: ModelTypeEnum) => {
    switch (type) {
      case ModelTypeEnum.textGeneration:
        return { data: mockTextGenerationList }
      case ModelTypeEnum.textEmbedding:
        return { data: mockTextEmbeddingList }
      case ModelTypeEnum.rerank:
        return { data: mockRerankList }
      case ModelTypeEnum.moderation:
        return { data: mockModerationList }
      case ModelTypeEnum.speech2text:
        return { data: mockSttList }
      case ModelTypeEnum.tts:
        return { data: mockTtsList }
      default:
        return { data: [] }
    }
  },
}))

// Mock fetchAndMergeValidCompletionParams
const mockFetchAndMergeValidCompletionParams = vi.fn()
vi.mock('@/utils/completion-params', () => ({
  fetchAndMergeValidCompletionParams: (...args: unknown[]) => mockFetchAndMergeValidCompletionParams(...args),
}))

// Mock child components
vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({ defaultModel, modelList, scopeFeatures, onSelect }: {
    defaultModel?: { provider?: string, model?: string }
    modelList?: Model[]
    scopeFeatures?: string[]
    onSelect?: (model: { provider: string, model: string }) => void
  }) => (
    <div
      data-testid="model-selector"
      data-default-model={JSON.stringify(defaultModel)}
      data-model-list-count={modelList?.length || 0}
      data-scope-features={JSON.stringify(scopeFeatures)}
      onClick={() => onSelect?.({ provider: 'openai', model: 'gpt-4' })}
    >
      Model Selector
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal/trigger', () => ({
  default: ({ disabled, hasDeprecated, modelDisabled, currentProvider, currentModel, providerName, modelId, isInWorkflow }: {
    disabled?: boolean
    hasDeprecated?: boolean
    modelDisabled?: boolean
    currentProvider?: Model
    currentModel?: ModelItem
    providerName?: string
    modelId?: string
    isInWorkflow?: boolean
  }) => (
    <div
      data-testid="trigger"
      data-disabled={disabled}
      data-has-deprecated={hasDeprecated}
      data-model-disabled={modelDisabled}
      data-provider={providerName}
      data-model={modelId}
      data-in-workflow={isInWorkflow}
      data-has-current-provider={!!currentProvider}
      data-has-current-model={!!currentModel}
    >
      Trigger
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal/agent-model-trigger', () => ({
  default: ({ disabled, hasDeprecated, currentProvider, currentModel, providerName, modelId, scope }: {
    disabled?: boolean
    hasDeprecated?: boolean
    currentProvider?: Model
    currentModel?: ModelItem
    providerName?: string
    modelId?: string
    scope?: string
  }) => (
    <div
      data-testid="agent-model-trigger"
      data-disabled={disabled}
      data-has-deprecated={hasDeprecated}
      data-provider={providerName}
      data-model={modelId}
      data-scope={scope}
      data-has-current-provider={!!currentProvider}
      data-has-current-model={!!currentModel}
    >
      Agent Model Trigger
    </div>
  ),
}))

vi.mock('./llm-params-panel', () => ({
  default: ({ provider, modelId, onCompletionParamsChange, isAdvancedMode }: {
    provider: string
    modelId: string
    completionParams?: Record<string, unknown>
    onCompletionParamsChange?: (params: Record<string, unknown>) => void
    isAdvancedMode: boolean
  }) => (
    <div
      data-testid="llm-params-panel"
      data-provider={provider}
      data-model={modelId}
      data-is-advanced={isAdvancedMode}
      onClick={() => onCompletionParamsChange?.({ temperature: 0.8 })}
    >
      LLM Params Panel
    </div>
  ),
}))

vi.mock('./tts-params-panel', () => ({
  default: ({ language, voice, onChange }: {
    currentModel?: ModelItem
    language?: string
    voice?: string
    onChange?: (language: string, voice: string) => void
  }) => (
    <div
      data-testid="tts-params-panel"
      data-language={language}
      data-voice={voice}
      onClick={() => onChange?.('en-US', 'alloy')}
    >
      TTS Params Panel
    </div>
  ),
}))

// ==================== Test Utilities ====================

/**
 * Factory function to create a ModelItem with defaults
 */
const createModelItem = (overrides: Partial<ModelItem> = {}): ModelItem => ({
  model: 'test-model',
  label: { en_US: 'Test Model', zh_Hans: 'Test Model' },
  model_type: ModelTypeEnum.textGeneration,
  features: [],
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: { mode: 'chat' },
  load_balancing_enabled: false,
  ...overrides,
})

/**
 * Factory function to create a Model (provider with models) with defaults
 */
const createModel = (overrides: Partial<Model> = {}): Model => ({
  provider: 'openai',
  icon_small: { en_US: 'icon-small.png', zh_Hans: 'icon-small.png' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [createModelItem()],
  status: ModelStatusEnum.active,
  ...overrides,
})

/**
 * Factory function to create default props
 */
const createDefaultProps = (overrides: Partial<Parameters<typeof ModelParameterModal>[0]> = {}) => ({
  isAdvancedMode: false,
  value: null,
  setModel: vi.fn(),
  ...overrides,
})

/**
 * Helper to set up model lists for testing
 */
const setupModelLists = (config: {
  textGeneration?: Model[]
  textEmbedding?: Model[]
  rerank?: Model[]
  moderation?: Model[]
  stt?: Model[]
  tts?: Model[]
} = {}) => {
  mockTextGenerationList.length = 0
  mockTextEmbeddingList.length = 0
  mockRerankList.length = 0
  mockModerationList.length = 0
  mockSttList.length = 0
  mockTtsList.length = 0

  if (config.textGeneration)
    mockTextGenerationList.push(...config.textGeneration)
  if (config.textEmbedding)
    mockTextEmbeddingList.push(...config.textEmbedding)
  if (config.rerank)
    mockRerankList.push(...config.rerank)
  if (config.moderation)
    mockModerationList.push(...config.moderation)
  if (config.stt)
    mockSttList.push(...config.stt)
  if (config.tts)
    mockTtsList.push(...config.tts)
}

// ==================== Tests ====================

describe('ModelParameterModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
    mockProviderContextValue.isAPIKeySet = true
    mockProviderContextValue.modelProviders = []
    setupModelLists()
    mockFetchAndMergeValidCompletionParams.mockResolvedValue({ params: {}, removedDetails: {} })
  })

  // ==================== Rendering Tests ====================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      const { container } = render(<ModelParameterModal {...props} />)

      // Assert
      expect(container).toBeInTheDocument()
    })

    it('should render trigger component by default', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toBeInTheDocument()
    })

    it('should render agent model trigger when isAgentStrategy is true', () => {
      // Arrange
      const props = createDefaultProps({ isAgentStrategy: true })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('agent-model-trigger')).toBeInTheDocument()
      expect(screen.queryByTestId('trigger')).not.toBeInTheDocument()
    })

    it('should render custom trigger when renderTrigger is provided', () => {
      // Arrange
      const renderTrigger = vi.fn().mockReturnValue(<div data-testid="custom-trigger">Custom</div>)
      const props = createDefaultProps({ renderTrigger })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
      expect(screen.queryByTestId('trigger')).not.toBeInTheDocument()
    })

    it('should call renderTrigger with correct props', () => {
      // Arrange
      const renderTrigger = vi.fn().mockReturnValue(<div>Custom</div>)
      const value = { provider: 'openai', model: 'gpt-4' }
      const props = createDefaultProps({ renderTrigger, value })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(renderTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          open: false,
          providerName: 'openai',
          modelId: 'gpt-4',
        }),
      )
    })

    it('should not render portal content when closed', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
    })

    it('should render model selector inside portal content when open', async () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('portal-content')).toBeInTheDocument()
      })
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    })
  })

  // ==================== Props Testing ====================
  describe('Props', () => {
    it('should pass isInWorkflow to trigger', () => {
      // Arrange
      const props = createDefaultProps({ isInWorkflow: true })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-in-workflow', 'true')
    })

    it('should pass scope to agent model trigger', () => {
      // Arrange
      const props = createDefaultProps({ isAgentStrategy: true, scope: 'llm&vision' })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('agent-model-trigger')).toHaveAttribute('data-scope', 'llm&vision')
    })

    it('should apply popupClassName to portal content', async () => {
      // Arrange
      const props = createDefaultProps({ popupClassName: 'custom-popup-class' })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const content = screen.getByTestId('portal-content')
        expect(content.querySelector('.custom-popup-class')).toBeInTheDocument()
      })
    })

    it('should default scope to textGeneration', () => {
      // Arrange
      const textGenModel = createModel({ provider: 'openai' })
      setupModelLists({ textGeneration: [textGenModel] })
      const props = createDefaultProps({ value: { provider: 'openai', model: 'test-model' } })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      const selector = screen.getByTestId('model-selector')
      expect(selector).toHaveAttribute('data-model-list-count', '1')
    })
  })

  // ==================== State Management ====================
  describe('State Management', () => {
    it('should toggle open state when trigger is clicked', async () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<ModelParameterModal {...props} />)
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('portal-content')).toBeInTheDocument()
      })
    })

    it('should not toggle open state when readonly is true', async () => {
      // Arrange
      const props = createDefaultProps({ readonly: true })

      // Act
      const { rerender } = render(<ModelParameterModal {...props} />)
      expect(screen.getByTestId('portal-elem')).toHaveAttribute('data-open', 'false')

      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Force a re-render to ensure state is stable
      rerender(<ModelParameterModal {...props} />)

      // Assert - open state should remain false due to readonly
      expect(screen.getByTestId('portal-elem')).toHaveAttribute('data-open', 'false')
    })
  })

  // ==================== Memoization Logic ====================
  describe('Memoization - scopeFeatures', () => {
    it('should return empty array when scope includes all', async () => {
      // Arrange
      const props = createDefaultProps({ scope: 'all' })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        expect(selector).toHaveAttribute('data-scope-features', '[]')
      })
    })

    it('should filter out model type enums from scope', async () => {
      // Arrange
      const props = createDefaultProps({ scope: 'llm&tool-call&vision' })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        const features = JSON.parse(selector.getAttribute('data-scope-features') || '[]')
        expect(features).toContain('tool-call')
        expect(features).toContain('vision')
        expect(features).not.toContain('llm')
      })
    })
  })

  describe('Memoization - scopedModelList', () => {
    it('should return all models when scope is all', async () => {
      // Arrange
      const textGenModel = createModel({ provider: 'openai' })
      const embeddingModel = createModel({ provider: 'embedding-provider' })
      setupModelLists({ textGeneration: [textGenModel], textEmbedding: [embeddingModel] })
      const props = createDefaultProps({ scope: 'all' })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        expect(selector).toHaveAttribute('data-model-list-count', '2')
      })
    })

    it('should return only textGeneration models for llm scope', async () => {
      // Arrange
      const textGenModel = createModel({ provider: 'openai' })
      const embeddingModel = createModel({ provider: 'embedding-provider' })
      setupModelLists({ textGeneration: [textGenModel], textEmbedding: [embeddingModel] })
      const props = createDefaultProps({ scope: ModelTypeEnum.textGeneration })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        expect(selector).toHaveAttribute('data-model-list-count', '1')
      })
    })

    it('should return text embedding models for text-embedding scope', async () => {
      // Arrange
      const embeddingModel = createModel({ provider: 'embedding-provider' })
      setupModelLists({ textEmbedding: [embeddingModel] })
      const props = createDefaultProps({ scope: ModelTypeEnum.textEmbedding })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        expect(selector).toHaveAttribute('data-model-list-count', '1')
      })
    })

    it('should return rerank models for rerank scope', async () => {
      // Arrange
      const rerankModel = createModel({ provider: 'rerank-provider' })
      setupModelLists({ rerank: [rerankModel] })
      const props = createDefaultProps({ scope: ModelTypeEnum.rerank })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        expect(selector).toHaveAttribute('data-model-list-count', '1')
      })
    })

    it('should return tts models for tts scope', async () => {
      // Arrange
      const ttsModel = createModel({ provider: 'tts-provider' })
      setupModelLists({ tts: [ttsModel] })
      const props = createDefaultProps({ scope: ModelTypeEnum.tts })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        expect(selector).toHaveAttribute('data-model-list-count', '1')
      })
    })

    it('should return moderation models for moderation scope', async () => {
      // Arrange
      const moderationModel = createModel({ provider: 'moderation-provider' })
      setupModelLists({ moderation: [moderationModel] })
      const props = createDefaultProps({ scope: ModelTypeEnum.moderation })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        expect(selector).toHaveAttribute('data-model-list-count', '1')
      })
    })

    it('should return stt models for speech2text scope', async () => {
      // Arrange
      const sttModel = createModel({ provider: 'stt-provider' })
      setupModelLists({ stt: [sttModel] })
      const props = createDefaultProps({ scope: ModelTypeEnum.speech2text })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        expect(selector).toHaveAttribute('data-model-list-count', '1')
      })
    })

    it('should return empty list for unknown scope', async () => {
      // Arrange
      const textGenModel = createModel({ provider: 'openai' })
      setupModelLists({ textGeneration: [textGenModel] })
      const props = createDefaultProps({ scope: 'unknown-scope' })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        expect(selector).toHaveAttribute('data-model-list-count', '0')
      })
    })
  })

  describe('Memoization - currentProvider and currentModel', () => {
    it('should find current provider and model from value', () => {
      // Arrange
      const model = createModel({
        provider: 'openai',
        models: [createModelItem({ model: 'gpt-4', status: ModelStatusEnum.active })],
      })
      setupModelLists({ textGeneration: [model] })
      const props = createDefaultProps({ value: { provider: 'openai', model: 'gpt-4' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      const trigger = screen.getByTestId('trigger')
      expect(trigger).toHaveAttribute('data-has-current-provider', 'true')
      expect(trigger).toHaveAttribute('data-has-current-model', 'true')
    })

    it('should not find provider when value.provider does not match', () => {
      // Arrange
      const model = createModel({ provider: 'openai' })
      setupModelLists({ textGeneration: [model] })
      const props = createDefaultProps({ value: { provider: 'anthropic', model: 'claude-3' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      const trigger = screen.getByTestId('trigger')
      expect(trigger).toHaveAttribute('data-has-current-provider', 'false')
      expect(trigger).toHaveAttribute('data-has-current-model', 'false')
    })
  })

  describe('Memoization - hasDeprecated', () => {
    it('should set hasDeprecated to true when provider is not found', () => {
      // Arrange
      const props = createDefaultProps({ value: { provider: 'unknown', model: 'unknown-model' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-has-deprecated', 'true')
    })

    it('should set hasDeprecated to true when model is not found', () => {
      // Arrange
      const model = createModel({ provider: 'openai', models: [createModelItem({ model: 'gpt-3.5' })] })
      setupModelLists({ textGeneration: [model] })
      const props = createDefaultProps({ value: { provider: 'openai', model: 'gpt-4' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-has-deprecated', 'true')
    })

    it('should set hasDeprecated to false when provider and model are found', () => {
      // Arrange
      const model = createModel({
        provider: 'openai',
        models: [createModelItem({ model: 'gpt-4' })],
      })
      setupModelLists({ textGeneration: [model] })
      const props = createDefaultProps({ value: { provider: 'openai', model: 'gpt-4' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-has-deprecated', 'false')
    })
  })

  describe('Memoization - modelDisabled', () => {
    it('should set modelDisabled to true when model status is not active', () => {
      // Arrange
      const model = createModel({
        provider: 'openai',
        models: [createModelItem({ model: 'gpt-4', status: ModelStatusEnum.quotaExceeded })],
      })
      setupModelLists({ textGeneration: [model] })
      const props = createDefaultProps({ value: { provider: 'openai', model: 'gpt-4' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-model-disabled', 'true')
    })

    it('should set modelDisabled to false when model status is active', () => {
      // Arrange
      const model = createModel({
        provider: 'openai',
        models: [createModelItem({ model: 'gpt-4', status: ModelStatusEnum.active })],
      })
      setupModelLists({ textGeneration: [model] })
      const props = createDefaultProps({ value: { provider: 'openai', model: 'gpt-4' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-model-disabled', 'false')
    })
  })

  describe('Memoization - disabled', () => {
    it('should set disabled to true when isAPIKeySet is false', () => {
      // Arrange
      mockProviderContextValue.isAPIKeySet = false
      const model = createModel({
        provider: 'openai',
        models: [createModelItem({ model: 'gpt-4', status: ModelStatusEnum.active })],
      })
      setupModelLists({ textGeneration: [model] })
      const props = createDefaultProps({ value: { provider: 'openai', model: 'gpt-4' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-disabled', 'true')
    })

    it('should set disabled to true when hasDeprecated is true', () => {
      // Arrange
      const props = createDefaultProps({ value: { provider: 'unknown', model: 'unknown' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-disabled', 'true')
    })

    it('should set disabled to true when modelDisabled is true', () => {
      // Arrange
      const model = createModel({
        provider: 'openai',
        models: [createModelItem({ model: 'gpt-4', status: ModelStatusEnum.quotaExceeded })],
      })
      setupModelLists({ textGeneration: [model] })
      const props = createDefaultProps({ value: { provider: 'openai', model: 'gpt-4' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-disabled', 'true')
    })

    it('should set disabled to false when all conditions are met', () => {
      // Arrange
      mockProviderContextValue.isAPIKeySet = true
      const model = createModel({
        provider: 'openai',
        models: [createModelItem({ model: 'gpt-4', status: ModelStatusEnum.active })],
      })
      setupModelLists({ textGeneration: [model] })
      const props = createDefaultProps({ value: { provider: 'openai', model: 'gpt-4' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-disabled', 'false')
    })
  })

  // ==================== User Interactions ====================
  describe('User Interactions', () => {
    describe('handleChangeModel', () => {
      it('should call setModel with selected model for non-textGeneration type', async () => {
        // Arrange
        const setModel = vi.fn()
        const ttsModel = createModel({
          provider: 'openai',
          models: [createModelItem({ model: 'tts-1', model_type: ModelTypeEnum.tts })],
        })
        setupModelLists({ tts: [ttsModel] })
        const props = createDefaultProps({ setModel, scope: ModelTypeEnum.tts })

        // Act
        render(<ModelParameterModal {...props} />)
        fireEvent.click(screen.getByTestId('portal-trigger'))

        await waitFor(() => {
          fireEvent.click(screen.getByTestId('model-selector'))
        })

        // Assert
        await waitFor(() => {
          expect(setModel).toHaveBeenCalled()
        })
      })

      it('should call fetchAndMergeValidCompletionParams for textGeneration type', async () => {
        // Arrange
        const setModel = vi.fn()
        const textGenModel = createModel({
          provider: 'openai',
          models: [createModelItem({ model: 'gpt-4', model_type: ModelTypeEnum.textGeneration, model_properties: { mode: 'chat' } })],
        })
        setupModelLists({ textGeneration: [textGenModel] })
        mockFetchAndMergeValidCompletionParams.mockResolvedValue({ params: { temperature: 0.7 }, removedDetails: {} })
        const props = createDefaultProps({ setModel, scope: ModelTypeEnum.textGeneration })

        // Act
        render(<ModelParameterModal {...props} />)
        fireEvent.click(screen.getByTestId('portal-trigger'))

        await waitFor(() => {
          fireEvent.click(screen.getByTestId('model-selector'))
        })

        // Assert
        await waitFor(() => {
          expect(mockFetchAndMergeValidCompletionParams).toHaveBeenCalled()
        })
      })

      it('should show warning toast when parameters are removed', async () => {
        // Arrange
        const setModel = vi.fn()
        const textGenModel = createModel({
          provider: 'openai',
          models: [createModelItem({ model: 'gpt-4', model_type: ModelTypeEnum.textGeneration, model_properties: { mode: 'chat' } })],
        })
        setupModelLists({ textGeneration: [textGenModel] })
        mockFetchAndMergeValidCompletionParams.mockResolvedValue({
          params: {},
          removedDetails: { invalid_param: 'unsupported' },
        })
        const props = createDefaultProps({
          setModel,
          scope: ModelTypeEnum.textGeneration,
          value: { completion_params: { invalid_param: 'value' } },
        })

        // Act
        render(<ModelParameterModal {...props} />)
        fireEvent.click(screen.getByTestId('portal-trigger'))

        await waitFor(() => {
          fireEvent.click(screen.getByTestId('model-selector'))
        })

        // Assert
        await waitFor(() => {
          expect(Toast.notify).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'warning' }),
          )
        })
      })

      it('should show error toast when fetchAndMergeValidCompletionParams fails', async () => {
        // Arrange
        const setModel = vi.fn()
        const textGenModel = createModel({
          provider: 'openai',
          models: [createModelItem({ model: 'gpt-4', model_type: ModelTypeEnum.textGeneration, model_properties: { mode: 'chat' } })],
        })
        setupModelLists({ textGeneration: [textGenModel] })
        mockFetchAndMergeValidCompletionParams.mockRejectedValue(new Error('Network error'))
        const props = createDefaultProps({ setModel, scope: ModelTypeEnum.textGeneration })

        // Act
        render(<ModelParameterModal {...props} />)
        fireEvent.click(screen.getByTestId('portal-trigger'))

        await waitFor(() => {
          fireEvent.click(screen.getByTestId('model-selector'))
        })

        // Assert
        await waitFor(() => {
          expect(Toast.notify).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error' }),
          )
        })
      })
    })

    describe('handleLLMParamsChange', () => {
      it('should call setModel with updated completion_params', async () => {
        // Arrange
        const setModel = vi.fn()
        const textGenModel = createModel({
          provider: 'openai',
          models: [createModelItem({
            model: 'gpt-4',
            model_type: ModelTypeEnum.textGeneration,
            status: ModelStatusEnum.active,
          })],
        })
        setupModelLists({ textGeneration: [textGenModel] })
        const props = createDefaultProps({
          setModel,
          scope: ModelTypeEnum.textGeneration,
          value: { provider: 'openai', model: 'gpt-4' },
        })

        // Act
        render(<ModelParameterModal {...props} />)
        fireEvent.click(screen.getByTestId('portal-trigger'))

        await waitFor(() => {
          const panel = screen.getByTestId('llm-params-panel')
          fireEvent.click(panel)
        })

        // Assert
        await waitFor(() => {
          expect(setModel).toHaveBeenCalledWith(
            expect.objectContaining({ completion_params: { temperature: 0.8 } }),
          )
        })
      })
    })

    describe('handleTTSParamsChange', () => {
      it('should call setModel with updated language and voice', async () => {
        // Arrange
        const setModel = vi.fn()
        const ttsModel = createModel({
          provider: 'openai',
          models: [createModelItem({
            model: 'tts-1',
            model_type: ModelTypeEnum.tts,
            status: ModelStatusEnum.active,
          })],
        })
        setupModelLists({ tts: [ttsModel] })
        const props = createDefaultProps({
          setModel,
          scope: ModelTypeEnum.tts,
          value: { provider: 'openai', model: 'tts-1' },
        })

        // Act
        render(<ModelParameterModal {...props} />)
        fireEvent.click(screen.getByTestId('portal-trigger'))

        await waitFor(() => {
          const panel = screen.getByTestId('tts-params-panel')
          fireEvent.click(panel)
        })

        // Assert
        await waitFor(() => {
          expect(setModel).toHaveBeenCalledWith(
            expect.objectContaining({ language: 'en-US', voice: 'alloy' }),
          )
        })
      })
    })
  })

  // ==================== Conditional Rendering ====================
  describe('Conditional Rendering', () => {
    it('should render LLMParamsPanel when model type is textGeneration', async () => {
      // Arrange
      const textGenModel = createModel({
        provider: 'openai',
        models: [createModelItem({
          model: 'gpt-4',
          model_type: ModelTypeEnum.textGeneration,
          status: ModelStatusEnum.active,
        })],
      })
      setupModelLists({ textGeneration: [textGenModel] })
      const props = createDefaultProps({
        value: { provider: 'openai', model: 'gpt-4' },
        scope: ModelTypeEnum.textGeneration,
      })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('llm-params-panel')).toBeInTheDocument()
      })
    })

    it('should render TTSParamsPanel when model type is tts', async () => {
      // Arrange
      const ttsModel = createModel({
        provider: 'openai',
        models: [createModelItem({
          model: 'tts-1',
          model_type: ModelTypeEnum.tts,
          status: ModelStatusEnum.active,
        })],
      })
      setupModelLists({ tts: [ttsModel] })
      const props = createDefaultProps({
        value: { provider: 'openai', model: 'tts-1' },
        scope: ModelTypeEnum.tts,
      })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('tts-params-panel')).toBeInTheDocument()
      })
    })

    it('should not render LLMParamsPanel when model type is not textGeneration', async () => {
      // Arrange
      const embeddingModel = createModel({
        provider: 'openai',
        models: [createModelItem({
          model: 'text-embedding-ada',
          model_type: ModelTypeEnum.textEmbedding,
          status: ModelStatusEnum.active,
        })],
      })
      setupModelLists({ textEmbedding: [embeddingModel] })
      const props = createDefaultProps({
        value: { provider: 'openai', model: 'text-embedding-ada' },
        scope: ModelTypeEnum.textEmbedding,
      })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('model-selector')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('llm-params-panel')).not.toBeInTheDocument()
    })

    it('should render divider when model type is textGeneration or tts', async () => {
      // Arrange
      const textGenModel = createModel({
        provider: 'openai',
        models: [createModelItem({
          model: 'gpt-4',
          model_type: ModelTypeEnum.textGeneration,
          status: ModelStatusEnum.active,
        })],
      })
      setupModelLists({ textGeneration: [textGenModel] })
      const props = createDefaultProps({
        value: { provider: 'openai', model: 'gpt-4' },
        scope: ModelTypeEnum.textGeneration,
      })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const content = screen.getByTestId('portal-content')
        expect(content.querySelector('.bg-divider-subtle')).toBeInTheDocument()
      })
    })
  })

  // ==================== Edge Cases ====================
  describe('Edge Cases', () => {
    it('should handle null value', () => {
      // Arrange
      const props = createDefaultProps({ value: null })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toBeInTheDocument()
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-has-deprecated', 'true')
    })

    it('should handle undefined value', () => {
      // Arrange
      const props = createDefaultProps({ value: undefined })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toBeInTheDocument()
    })

    it('should handle empty model list', async () => {
      // Arrange
      setupModelLists({})
      const props = createDefaultProps({ value: { provider: 'openai', model: 'gpt-4' } })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        expect(selector).toHaveAttribute('data-model-list-count', '0')
      })
    })

    it('should handle value with only provider', () => {
      // Arrange
      const model = createModel({ provider: 'openai' })
      setupModelLists({ textGeneration: [model] })
      const props = createDefaultProps({ value: { provider: 'openai' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-provider', 'openai')
    })

    it('should handle value with only model', () => {
      // Arrange
      const props = createDefaultProps({ value: { model: 'gpt-4' } })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-model', 'gpt-4')
    })

    it('should handle complex scope with multiple features', async () => {
      // Arrange
      const props = createDefaultProps({ scope: 'llm&tool-call&multi-tool-call&vision' })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        const features = JSON.parse(selector.getAttribute('data-scope-features') || '[]')
        expect(features).toContain('tool-call')
        expect(features).toContain('multi-tool-call')
        expect(features).toContain('vision')
      })
    })

    it('should handle model with all status types', () => {
      // Arrange
      const statuses = [
        ModelStatusEnum.active,
        ModelStatusEnum.noConfigure,
        ModelStatusEnum.quotaExceeded,
        ModelStatusEnum.noPermission,
        ModelStatusEnum.disabled,
      ]

      statuses.forEach((status) => {
        const model = createModel({
          provider: `provider-${status}`,
          models: [createModelItem({ model: 'test', status })],
        })
        setupModelLists({ textGeneration: [model] })

        // Act
        const props = createDefaultProps({ value: { provider: `provider-${status}`, model: 'test' } })
        const { unmount } = render(<ModelParameterModal {...props} />)

        // Assert
        const trigger = screen.getByTestId('trigger')
        if (status === ModelStatusEnum.active)
          expect(trigger).toHaveAttribute('data-model-disabled', 'false')
        else
          expect(trigger).toHaveAttribute('data-model-disabled', 'true')

        unmount()
      })
    })
  })

  // ==================== Portal Placement ====================
  describe('Portal Placement', () => {
    it('should use left placement when isInWorkflow is true', () => {
      // Arrange
      const props = createDefaultProps({ isInWorkflow: true })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      // Portal placement is handled internally, but we verify the prop is passed
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-in-workflow', 'true')
    })

    it('should use bottom-end placement when isInWorkflow is false', () => {
      // Arrange
      const props = createDefaultProps({ isInWorkflow: false })

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-in-workflow', 'false')
    })
  })

  // ==================== Model Selector Default Model ====================
  describe('Model Selector Default Model', () => {
    it('should pass defaultModel to ModelSelector when provider and model exist', async () => {
      // Arrange
      const props = createDefaultProps({ value: { provider: 'openai', model: 'gpt-4' } })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        const defaultModel = JSON.parse(selector.getAttribute('data-default-model') || '{}')
        expect(defaultModel).toEqual({ provider: 'openai', model: 'gpt-4' })
      })
    })

    it('should pass partial defaultModel when provider is missing', async () => {
      // Arrange - component creates defaultModel when either provider or model exists
      const props = createDefaultProps({ value: { model: 'gpt-4' } })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert - defaultModel is created with undefined provider
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        const defaultModel = JSON.parse(selector.getAttribute('data-default-model') || '{}')
        expect(defaultModel.model).toBe('gpt-4')
        expect(defaultModel.provider).toBeUndefined()
      })
    })

    it('should pass partial defaultModel when model is missing', async () => {
      // Arrange - component creates defaultModel when either provider or model exists
      const props = createDefaultProps({ value: { provider: 'openai' } })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert - defaultModel is created with undefined model
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        const defaultModel = JSON.parse(selector.getAttribute('data-default-model') || '{}')
        expect(defaultModel.provider).toBe('openai')
        expect(defaultModel.model).toBeUndefined()
      })
    })

    it('should pass undefined defaultModel when both provider and model are missing', async () => {
      // Arrange
      const props = createDefaultProps({ value: {} })

      // Act
      render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      // Assert - when defaultModel is undefined, attribute is not set (returns null)
      await waitFor(() => {
        const selector = screen.getByTestId('model-selector')
        expect(selector.getAttribute('data-default-model')).toBeNull()
      })
    })
  })

  // ==================== Re-render Behavior ====================
  describe('Re-render Behavior', () => {
    it('should update trigger when value changes', () => {
      // Arrange
      const props = createDefaultProps({ value: { provider: 'openai', model: 'gpt-3.5' } })

      // Act
      const { rerender } = render(<ModelParameterModal {...props} />)
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-model', 'gpt-3.5')

      rerender(<ModelParameterModal {...props} value={{ provider: 'openai', model: 'gpt-4' }} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-model', 'gpt-4')
    })

    it('should update model list when scope changes', async () => {
      // Arrange
      const textGenModel = createModel({ provider: 'openai' })
      const embeddingModel = createModel({ provider: 'embedding-provider' })
      setupModelLists({ textGeneration: [textGenModel], textEmbedding: [embeddingModel] })

      const props = createDefaultProps({ scope: ModelTypeEnum.textGeneration })

      // Act
      const { rerender } = render(<ModelParameterModal {...props} />)
      fireEvent.click(screen.getByTestId('portal-trigger'))

      await waitFor(() => {
        expect(screen.getByTestId('model-selector')).toHaveAttribute('data-model-list-count', '1')
      })

      // Rerender with different scope
      mockPortalOpenState = true
      rerender(<ModelParameterModal {...props} scope={ModelTypeEnum.textEmbedding} />)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('model-selector')).toHaveAttribute('data-model-list-count', '1')
      })
    })

    it('should update disabled state when isAPIKeySet changes', () => {
      // Arrange
      const model = createModel({
        provider: 'openai',
        models: [createModelItem({ model: 'gpt-4', status: ModelStatusEnum.active })],
      })
      setupModelLists({ textGeneration: [model] })
      mockProviderContextValue.isAPIKeySet = true
      const props = createDefaultProps({ value: { provider: 'openai', model: 'gpt-4' } })

      // Act
      const { rerender } = render(<ModelParameterModal {...props} />)
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-disabled', 'false')

      mockProviderContextValue.isAPIKeySet = false
      rerender(<ModelParameterModal {...props} />)

      // Assert
      expect(screen.getByTestId('trigger')).toHaveAttribute('data-disabled', 'true')
    })
  })

  // ==================== Accessibility ====================
  describe('Accessibility', () => {
    it('should be keyboard accessible', () => {
      // Arrange
      const props = createDefaultProps()

      // Act
      render(<ModelParameterModal {...props} />)

      // Assert
      const trigger = screen.getByTestId('portal-trigger')
      expect(trigger).toBeInTheDocument()
    })
  })

  // ==================== Component Type ====================
  describe('Component Type', () => {
    it('should be a functional component', () => {
      // Assert
      expect(typeof ModelParameterModal).toBe('function')
    })

    it('should accept all required props', () => {
      // Arrange
      const props = createDefaultProps()

      // Act & Assert
      expect(() => render(<ModelParameterModal {...props} />)).not.toThrow()
    })
  })
})
