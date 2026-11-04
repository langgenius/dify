import { describe, expect, it } from 'vite-plus/test'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringModeEnum,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { RerankingModeEnum } from '@/models/datasets'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { RETRIEVE_TYPE } from '@/types/app'
import { validateKnowledgeRetrievals } from '../knowledge-validation'

describe('validateKnowledgeRetrievals', () => {
  it.each([
    { operator: ComparisonOperator.equal, value: undefined, valid: false },
    { operator: ComparisonOperator.equal, value: null, valid: false },
    { operator: ComparisonOperator.is, value: '', valid: false },
    { operator: ComparisonOperator.contains, value: '   ', valid: false },
    { operator: ComparisonOperator.in, value: [], valid: false },
    { operator: ComparisonOperator.equal, value: 0, valid: true },
    { operator: ComparisonOperator.empty, value: undefined, valid: true },
    { operator: ComparisonOperator.notEmpty, value: null, valid: true },
  ])('validates every manual condition value: $operator / $value', ({ operator, value, valid }) => {
    const result = validateKnowledgeRetrievals([
      {
        id: 'classic',
        name: 'Saved search',
        datasetRefs: [{ id: 'dataset' }],
        metadataFilterMode: MetadataFilteringModeEnum.manual,
        metadataFilteringConditions: {
          logical_operator: LogicalOperator.and,
          conditions: [
            { id: 'first', name: 'stock', comparison_operator: ComparisonOperator.equal, value: 1 },
            { id: 'second', name: 'price', comparison_operator: operator, value },
          ],
        },
      },
    ])
    expect(result.isValid).toBe(valid)
    if (!valid) expect(result.byId.classic).toEqual({ metadata: 'metadata_value_required' })
  })

  it('rejects an enabled reranker without a model even before dataset details load', () => {
    const binding = {
      id: 'classic',
      name: 'Saved search',
      datasetRefs: [{ id: 'dataset-1' }],
      multipleRetrievalConfig: {
        top_k: 4,
        score_threshold: null,
        reranking_mode: RerankingModeEnum.RerankingModel,
        reranking_enable: true,
      },
    }
    expect(validateKnowledgeRetrievals([binding]).byId.classic).toEqual({
      retrieval: 'rerank_model_required',
    })
    expect(
      validateKnowledgeRetrievals([
        {
          ...binding,
          multipleRetrievalConfig: {
            ...binding.multipleRetrievalConfig,
            reranking_model: { provider: 'cohere', model: 'rerank-v3' },
          },
        },
      ]).isValid,
    ).toBe(true)
  })

  it('keeps optional reranking disabled for saved and loaded economy bindings', () => {
    const binding = {
      id: 'classic',
      name: 'Saved search',
      datasetRefs: [{ id: 'dataset-1' }],
      multipleRetrievalConfig: {
        top_k: 4,
        score_threshold: null,
        reranking_mode: RerankingModeEnum.RerankingModel,
        reranking_enable: false,
      },
    }
    expect(validateKnowledgeRetrievals([binding]).isValid).toBe(true)
    expect(
      validateKnowledgeRetrievals([
        {
          ...binding,
          selectedDatasets: [createDatasetFixture({ indexing_technique: 'economy' })],
        },
      ]).isValid,
    ).toBe(true)
  })

  it('accepts a valid Classic Knowledge Base binding', () => {
    const result = validateKnowledgeRetrievals([
      {
        id: 'retrieval-1',
        name: 'Docs Search',
        datasetRefs: [{ id: 'dataset-1', name: 'Docs' }],
        queryMode: 'agent',
        retrievalMode: RETRIEVE_TYPE.multiWay,
      },
    ])

    expect(result).toMatchObject({
      isValid: true,
    })
  })

  it('counts only Agent Knowledge Base bindings toward the 10-space limit', () => {
    const classic = {
      id: 'classic',
      name: 'Classic Docs',
      datasetRefs: [{ id: 'dataset-1', name: 'Docs' }],
    }
    const spaces = Array.from({ length: 10 }, (_, index) => ({
      id: `space-${index}`,
      name: `Space ${index}`,
      controlSpaceId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }))

    expect(validateKnowledgeRetrievals([classic, ...spaces]).isValid).toBe(true)
    expect(
      validateKnowledgeRetrievals([
        ...spaces,
        {
          ...spaces[0],
          id: 'extra',
          name: 'Extra',
          controlSpaceId: '00000000-0000-4000-8000-000000000011',
        },
      ]).isValid,
    ).toBe(false)
  })

  it('should reject blank and duplicate names', () => {
    const result = validateKnowledgeRetrievals([
      {
        id: 'retrieval-1',
        name: '   ',
        datasetRefs: [{ id: 'dataset-1', name: 'Docs' }],
      },
      {
        id: 'retrieval-2',
        name: 'Docs Search',
        datasetRefs: [{ id: 'dataset-2', name: 'FAQ' }],
      },
      {
        id: 'retrieval-3',
        name: ' docs search ',
        datasetRefs: [{ id: 'dataset-3', name: 'Guide' }],
      },
    ])

    expect(result.isValid).toBe(false)
    expect(result.byId['retrieval-1']).toMatchObject({ name: 'name_required' })
    expect(result.byId['retrieval-2']).toMatchObject({ name: 'name_duplicate' })
    expect(result.byId['retrieval-3']).toMatchObject({ name: 'name_duplicate' })
  })

  it('should reject missing datasets, blank custom queries, and missing single-retrieval model', () => {
    const result = validateKnowledgeRetrievals([
      {
        id: 'retrieval-1',
        name: 'Product Docs',
        queryMode: 'custom',
        customQuery: '   ',
        retrievalMode: RETRIEVE_TYPE.oneWay,
        singleRetrievalConfig: {
          model: {
            provider: '',
            name: '',
            mode: 'chat',
            completion_params: {},
          },
        },
      },
    ])

    expect(result.isValid).toBe(false)
    expect(result.byId['retrieval-1']).toMatchObject({
      datasets: 'datasets_required',
      query: 'custom_query_required',
      retrieval: 'single_model_required',
    })
  })

  it('should reject invalid metadata filtering requirements', () => {
    const result = validateKnowledgeRetrievals([
      {
        id: 'retrieval-1',
        name: 'Auto Metadata',
        datasetRefs: [{ id: 'dataset-1', name: 'Docs' }],
        metadataFilterMode: MetadataFilteringModeEnum.automatic,
      },
      {
        id: 'retrieval-2',
        name: 'Manual Metadata',
        datasetRefs: [{ id: 'dataset-2', name: 'FAQ' }],
        metadataFilterMode: MetadataFilteringModeEnum.manual,
        metadataFilteringConditions: {
          logical_operator: LogicalOperator.and,
          conditions: [],
        },
      },
    ])

    expect(result.isValid).toBe(false)
    expect(result.byId['retrieval-1']).toMatchObject({ metadata: 'metadata_model_required' })
    expect(result.byId['retrieval-2']).toMatchObject({ metadata: 'metadata_conditions_required' })
  })
})
