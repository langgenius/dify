import type { KnowledgeBaseNodeType } from '../types'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { zModelWithProviderEntityResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { screen } from '@testing-library/react'
import { ModelStatusEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper, renderWithConsoleQuery } from '@/test/console/query-data'
import Node from '../node'
import { ChunkStructureEnum, IndexMethodEnum, RetrievalSearchMethodEnum } from '../types'

const createNodeData = (
  overrides: Partial<CommonNodeType<KnowledgeBaseNodeType>> = {},
): CommonNodeType<KnowledgeBaseNodeType> => ({
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

function renderNode(
  data = createNodeData(),
  model = createCatalogModelFixture({
    model: 'text-embedding-3-large',
    label: { en_US: 'Text Embedding 3 Large' },
    model_type: 'text-embedding',
  }),
) {
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient, [createModelCatalogFixture({ models: [model] })])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
      input: { params: { provider: 'openai' } },
    }),
    {
      data: [
        zModelWithProviderEntityResponse.parse({
          ...model,
          provider: createDefaultModelFixture({ model_type: 'text-embedding' }).provider,
        }),
      ],
    },
  )
  return renderWithConsoleQuery(<Node id="knowledge-base-1" data={data} />, { queryClient })
}

describe('KnowledgeBaseNode', () => {
  // Embedding model row should mirror the selector status labels.
  describe('Embedding Model Status', () => {
    it.each([
      { status: ModelStatusEnum.active, label: 'Text Embedding 3 Large' },
      {
        status: ModelStatusEnum.noConfigure,
        label: 'modelProvider.modelProvider.selector.configureRequired',
      },
      { status: ModelStatusEnum.disabled, label: 'modelProvider.modelProvider.selector.disabled' },
    ])('renders $status from the selected model in the provider catalog', ({ status, label }) => {
      renderNode(
        createNodeData(),
        createCatalogModelFixture({
          model: 'text-embedding-3-large',
          model_type: 'text-embedding',
          label: { en_US: 'Text Embedding 3 Large' },
          status,
        }),
      )

      expect(screen.getByText(label)).toBeInTheDocument()
    })

    it('should render incompatible when embedding model status is incompatible', () => {
      renderNode(
        createNodeData(),
        createCatalogModelFixture({
          model: 'another-model',
          model_type: 'text-embedding',
        }),
      )

      expect(
        screen.getByText('modelProvider.modelProvider.selector.incompatible'),
      ).toBeInTheDocument()
    })

    it('should render configure model prompt when no embedding model is selected', () => {
      renderNode(
        createNodeData({
          embedding_model: undefined,
          embedding_model_provider: undefined,
        }),
      )

      expect(screen.getByText('plugin.detailPanel.configureModel')).toBeInTheDocument()
    })
  })

  describe('Validation warnings', () => {
    it('should render a warning banner when chunk structure is missing', () => {
      renderNode(
        createNodeData({
          chunk_structure: undefined,
        }),
      )

      expect(screen.getByText(/chunkIsRequired/i)).toBeInTheDocument()
    })

    it('should render a warning value for the chunks input row when no chunk variable is selected', () => {
      renderNode(
        createNodeData({
          index_chunk_variable_selector: [],
        }),
      )

      expect(screen.getByText(/chunksVariableIsRequired/i)).toBeInTheDocument()
    })

    it('should render a warning value for retrieval settings when reranking is incomplete', async () => {
      renderNode(
        createNodeData({
          retrieval_model: {
            top_k: 3,
            score_threshold_enabled: false,
            score_threshold: 0.5,
            search_method: RetrievalSearchMethodEnum.semantic,
            reranking_enable: true,
          },
        }),
      )

      expect(await screen.findByText(/rerankingModelIsRequired/i)).toBeInTheDocument()
    })

    it('should hide the embedding model row when the index method is not qualified', () => {
      renderNode(
        createNodeData({
          indexing_technique: IndexMethodEnum.ECONOMICAL,
        }),
      )

      expect(screen.queryByText('Text Embedding 3 Large')).not.toBeInTheDocument()
    })
  })
})
