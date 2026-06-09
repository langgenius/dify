import { renderHook } from '@testing-library/react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  createCredentialState,
  createModel,
  createModelItem,
  createProviderMeta,
} from '@/app/components/workflow/__tests__/model-provider-fixtures'
import { useEmbeddingModelStatus } from '../use-embedding-model-status'

const mockUseCredentialPanelState = vi.hoisted(() => vi.fn())
const mockUseProviderContext = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state', () => ({
  useCredentialPanelState: mockUseCredentialPanelState,
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: mockUseProviderContext,
}))

describe('useEmbeddingModelStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProviderContext.mockReturnValue({
      modelProviders: [createProviderMeta({
        supported_model_types: [ModelTypeEnum.textEmbedding],
      })],
    })
    mockUseCredentialPanelState.mockReturnValue(createCredentialState())
  })

  // The hook should resolve provider and model metadata before deriving the final status.
  describe('Resolution', () => {
    it('should return the matched provider, current model, and active status', () => {
      const embeddingModelList = [createModel()]

      const { result } = renderHook(() => useEmbeddingModelStatus({
        embeddingModel: 'text-embedding-3-large',
        embeddingModelProvider: 'openai',
        embeddingModelList,
      }))

      expect(result.current.providerMeta?.provider).toBe('openai')
      expect(result.current.modelProvider?.provider).toBe('openai')
      expect(result.current.currentModel?.model).toBe('text-embedding-3-large')
      expect(result.current.status).toBe('active')
    })

    it('should return incompatible when the provider exists but the selected model is missing', () => {
      const embeddingModelList = [
        createModel({
          models: [createModelItem({ model: 'another-model' })],
        }),
      ]

      const { result } = renderHook(() => useEmbeddingModelStatus({
        embeddingModel: 'text-embedding-3-large',
        embeddingModelProvider: 'openai',
        embeddingModelList,
      }))

      expect(result.current.providerMeta?.provider).toBe('openai')
      expect(result.current.currentModel).toBeUndefined()
      expect(result.current.status).toBe('incompatible')
    })

    it('should return empty when no embedding model is configured', () => {
      const { result } = renderHook(() => useEmbeddingModelStatus({
        embeddingModel: undefined,
        embeddingModelProvider: undefined,
        embeddingModelList: [],
      }))

      expect(result.current.providerMeta).toBeUndefined()
      expect(result.current.modelProvider).toBeUndefined()
      expect(result.current.currentModel).toBeUndefined()
      expect(result.current.status).toBe('empty')
    })
  })
})
