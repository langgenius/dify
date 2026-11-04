import type {
  KnowledgeFsUpgradeJobResponse,
  KnowledgeFsUpgradePreparationResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createDatasetFixture } from '@/test/fixtures/dataset'

export const upgradeDataset = createDatasetFixture({ name: 'Support knowledge' })

export const upgradeJob = {
  completed_documents: 0,
  completed_sources: 0,
  id: 'upgrade-1',
  old_dataset_id: upgradeDataset.id,
  snapshot_at: '2026-08-18T00:00:00Z',
  stage: 'validating',
  status: 'queued',
  total_documents: 0,
  total_sources: 0,
} satisfies KnowledgeFsUpgradeJobResponse

export const upgradeModelCatalogs = [
  createModelCatalogFixture({
    provider: 'langgenius/openai/openai',
    models: [
      ...['gpt-4o', 'gpt-4o-mini'].map((model) =>
        createCatalogModelFixture({ model, label: { en_US: model }, model_type: 'llm' }),
      ),
      createCatalogModelFixture({
        model: 'text-embedding-3-small',
        label: { en_US: 'text-embedding-3-small' },
        model_type: 'text-embedding',
      }),
    ],
  }),
  createModelCatalogFixture({
    provider: 'langgenius/cohere/cohere',
    models: ['rerank-english', 'rerank-multilingual'].map((model) =>
      createCatalogModelFixture({ model, label: { en_US: model }, model_type: 'rerank' }),
    ),
  }),
]

export const recommendedUpgradeModels = {
  embedding: {
    available: true,
    source: 'legacy',
    value: { model: 'text-embedding-3-small', provider: 'openai' },
  },
  rerank: {
    available: true,
    source: 'workspace_default',
    value: { model: 'rerank-english', provider: 'langgenius/cohere/cohere' },
  },
  reasoning: {
    available: true,
    source: 'workspace_default',
    value: { model: 'gpt-4o', provider: 'langgenius/openai/openai' },
  },
} satisfies NonNullable<KnowledgeFsUpgradePreparationResponse['models']>

export const expectedUpgradeModels = {
  embedding: { model: 'text-embedding-3-small', provider: 'langgenius/openai/openai' },
  rerank: { model: 'rerank-english', provider: 'langgenius/cohere/cohere' },
  reasoning: { model: 'gpt-4o', provider: 'langgenius/openai/openai' },
}

export function seedUpgradeModels(client: QueryClient) {
  seedModelProviderQueries(client, upgradeModelCatalogs)
}
