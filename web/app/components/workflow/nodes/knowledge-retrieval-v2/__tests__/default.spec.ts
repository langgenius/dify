import type { KnowledgeRetrievalV2NodeType } from '../types'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import nodeDefault from '../default'

const t = withSelectorKey((key: string) => key, 'workflow')

const createPayload = (
  overrides: Partial<KnowledgeRetrievalV2NodeType> = {},
): KnowledgeRetrievalV2NodeType =>
  ({
    ...nodeDefault.defaultValue,
    title: 'Knowledge Retrieval v2',
    desc: '',
    type: BlockEnum.KnowledgeRetrievalV2,
    query_variable_selector: ['start', 'sys.query'],
    control_space_ids: ['space-1'],
    ...overrides,
  }) as KnowledgeRetrievalV2NodeType

describe('knowledge-retrieval-v2/default', () => {
  it('follows each space retrieval profile by default', () => {
    expect(nodeDefault.defaultValue).toMatchObject({
      query_variable_selector: [],
      control_space_ids: [],
      metadata_filtering_mode: MetadataFilteringModeEnum.disabled,
      top_n: 10,
    })
    expect(nodeDefault.defaultValue.mode).toBeUndefined()
  })

  it('requires a query variable', () => {
    const result = nodeDefault.checkValid(createPayload({ query_variable_selector: [] }), t)

    expect(result).toEqual({
      isValid: false,
      errorMessage: 'errorMsg.fieldRequired',
    })
  })

  it('requires at least one KnowledgeFS space', () => {
    const result = nodeDefault.checkValid(createPayload({ control_space_ids: [] }), t)

    expect(result).toEqual({
      isValid: false,
      errorMessage: 'errorMsg.fieldRequired',
    })
  })

  it('accepts a bounded complete configuration', () => {
    expect(nodeDefault.checkValid(createPayload(), t)).toEqual({
      isValid: true,
      errorMessage: '',
    })
  })
})
