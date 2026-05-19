import type { KnowledgeBaseNodeType } from '../types'
import type { ModelItem } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'
import {
  ChunkStructureEnum,
  IndexMethodEnum,
  RetrievalSearchMethodEnum,
} from '../types'

const mockUseModelList = vi.hoisted(() => vi.fn())
const mockUseSettingsDisplay = vi.hoisted(() => vi.fn())
const mockUseEmbeddingModelStatus = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: () => ({ data: undefined }),
  }
})

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/header/account-setting/model-provider-page/hooks')>()
  return {
    ...actual,
    useLanguage: () => 'en_US',
    useModelList: mockUseModelList,
  }
})

vi.mock('../hooks/use-settings-display', () => ({
  useSettingsDisplay: mockUseSettingsDisplay,
}))

vi.mock('../hooks/use-embedding-model-status', () => ({
  useEmbeddingModelStatus: mockUseEmbeddingModelStatus,
}))

const createModelItem = (overrides: Partial<ModelItem> = {}): ModelItem => ({
  model: 'text-embedding-3-large',
  label: { en_US: 'Text Embedding 3 Large', zh_Hans: 'Text Embedding 3 Large' },
  model_type: ModelTypeEnum.textEmbedding,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: {},
  load_balancing_enabled: false,
  ...overrides,
})

const createNodeData = (overrides: Partial<CommonNodeType<KnowledgeBaseNodeType>> = {}): CommonNodeType<KnowledgeBaseNodeType> => ({
  title: 'Knowledge Base',
  desc: '',
  type: BlockEnum.KnowledgeBase,
  index_chunk_variable_selector: ['result'],
  chunk_structure: ChunkStructureEnum.general,
  indexing_technique: IndexMethodEnum.QUALIFIED,
  embedding_model: 'text-embedding-3-large',
  embedding_model_provider: 'openai',
  keyword_number: 10,
  retrieval_model: {
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
    search_method: RetrievalSearchMethodEnum.semantic,
  },
  ...overrides,
})

describe('KnowledgeBaseNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseModelList.mockReturnValue({ data: [] })
    mockUseSettingsDisplay.mockReturnValue({
      [IndexMethodEnum.QUALIFIED]: 'High Quality',
      [RetrievalSearchMethodEnum.semantic]: 'Vector Search',
    })
    mockUseEmbeddingModelStatus.mockReturnValue({
      providerMeta: undefined,
      modelProvider: undefined,
      currentModel: createModelItem(),
      status: 'active',
    })
  })

  // Embedding model row should mirror the selector status labels.
  describe('Embedding Model Status', () => {
    it('should render active embedding model label when the model is available', () => {
      render(<Node id="knowledge-base-1" data={createNodeData()} />)

      expect(screen.getByText('Text Embedding 3 Large')).toBeInTheDocument()
    })

    it('should render configure required when embedding model status requires configuration', () => {
      mockUseEmbeddingModelStatus.mockReturnValue({
        providerMeta: undefined,
        modelProvider: undefined,
        currentModel: createModelItem({ status: ModelStatusEnum.noConfigure }),
        status: 'configure-required',
      })

      render(<Node id="knowledge-base-1" data={createNodeData()} />)

      expect(screen.getByText('common.modelProvider.selector.configureRequired')).toBeInTheDocument()
    })

    it('should render disabled when embedding model status is disabled', () => {
      mockUseEmbeddingModelStatus.mockReturnValue({
        providerMeta: undefined,
        modelProvider: undefined,
        currentModel: createModelItem({ status: ModelStatusEnum.disabled }),
        status: 'disabled',
      })

      render(<Node id="knowledge-base-1" data={createNodeData()} />)

      expect(screen.getByText('common.modelProvider.selector.disabled')).toBeInTheDocument()
    })

    it('should render incompatible when embedding model status is incompatible', () => {
      mockUseEmbeddingModelStatus.mockReturnValue({
        providerMeta: undefined,
        modelProvider: undefined,
        currentModel: undefined,
        status: 'incompatible',
      })

      render(<Node id="knowledge-base-1" data={createNodeData()} />)

      expect(screen.getByText('common.modelProvider.selector.incompatible')).toBeInTheDocument()
    })

    it('should render configure model prompt when no embedding model is selected', () => {
      mockUseEmbeddingModelStatus.mockReturnValue({
        providerMeta: undefined,
        modelProvider: undefined,
        currentModel: undefined,
        status: 'empty',
      })

      render(
        <Node
          id="knowledge-base-1"
          data={createNodeData({
            embedding_model: undefined,
            embedding_model_provider: undefined,
          })}
        />,
      )

      expect(screen.getByText('plugin.detailPanel.configureModel')).toBeInTheDocument()
    })
  })

  describe('Validation warnings', () => {
    it('should render a warning banner when chunk structure is missing', () => {
      render(
        <Node
          id="knowledge-base-1"
          data={createNodeData({
            chunk_structure: undefined,
          })}
        />,
      )

      expect(screen.getByText(/chunkIsRequired/i)).toBeInTheDocument()
    })

    it('should render a warning value for the chunks input row when no chunk variable is selected', () => {
      render(
        <Node
          id="knowledge-base-1"
          data={createNodeData({
            index_chunk_variable_selector: [],
          })}
        />,
      )

      expect(screen.getByText(/chunksVariableIsRequired/i)).toBeInTheDocument()
    })

    it('should render a warning value for retrieval settings when reranking is incomplete', () => {
      mockUseModelList.mockImplementation((modelType: ModelTypeEnum) => {
        if (modelType === ModelTypeEnum.textEmbedding) {
          return {
            data: [{
              provider: 'openai',
              models: [createModelItem()],
            }],
          }
        }
        return { data: [] }
      })

      render(
        <Node
          id="knowledge-base-1"
          data={createNodeData({
            retrieval_model: {
              top_k: 3,
              score_threshold_enabled: false,
              score_threshold: 0.5,
              search_method: RetrievalSearchMethodEnum.semantic,
              reranking_enable: true,
            },
          })}
        />,
      )

      expect(screen.getByText(/rerankingModelIsRequired/i)).toBeInTheDocument()
    })

    it('should hide the embedding model row when the index method is not qualified', () => {
      render(
        <Node
          id="knowledge-base-1"
          data={createNodeData({
            indexing_technique: IndexMethodEnum.ECONOMICAL,
          })}
        />,
      )

      expect(screen.queryByText('Text Embedding 3 Large')).not.toBeInTheDocument()
    })
  })
})
