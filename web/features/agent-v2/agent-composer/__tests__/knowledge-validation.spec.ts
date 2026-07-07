import { describe, expect, it } from 'vitest'
import { LogicalOperator, MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { RETRIEVE_TYPE } from '@/types/app'
import { validateKnowledgeRetrievals } from '../knowledge-validation'

describe('validateKnowledgeRetrievals', () => {
  it('should accept a valid generated-query knowledge retrieval', () => {
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
      byId: {},
      firstIssue: undefined,
    })
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
