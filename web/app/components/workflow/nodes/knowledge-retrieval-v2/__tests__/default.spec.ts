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
      query_attachment_selector: [],
      control_space_ids: [],
      metadata_filtering_mode: MetadataFilteringModeEnum.disabled,
      score_threshold: null,
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

  it('requires a metadata filtering model in automatic mode', () => {
    const invalid = nodeDefault.checkValid(
      createPayload({ metadata_filtering_mode: MetadataFilteringModeEnum.automatic }),
      t,
    )
    const valid = nodeDefault.checkValid(
      createPayload({
        metadata_filtering_mode: MetadataFilteringModeEnum.automatic,
        metadata_model_config: {
          provider: 'openai',
          name: 'gpt-4o-mini',
          mode: 'chat',
          completion_params: { temperature: 0.7 },
        },
      }),
      t,
    )

    expect(invalid).toEqual({
      isValid: false,
      errorMessage: 'errorMsg.fieldRequired',
    })
    expect(valid).toEqual({
      isValid: true,
      errorMessage: '',
    })
  })

  it('does not require a model outside automatic mode', () => {
    expect(
      nodeDefault.checkValid(
        createPayload({ metadata_filtering_mode: MetadataFilteringModeEnum.manual }),
        t,
      ),
    ).toEqual({
      isValid: true,
      errorMessage: '',
    })
  })
})
