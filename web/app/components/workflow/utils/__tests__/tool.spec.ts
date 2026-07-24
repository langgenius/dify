import type { ToolNodeType } from '../../nodes/tool/types'
import type { ToolWithProvider } from '../../types'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '../../types'
import { CHUNK_TYPE_MAP, getToolCheckParams, wrapStructuredVarItem } from '../tool'

vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  toolParametersToFormSchemas: vi.fn((params: Array<Record<string, unknown>>) =>
    params.map(p => ({
      variable: p.name,
      label: p.label || { en_US: p.name },
      type: p.type || 'string',
      required: p.required ?? false,
      form: p.form ?? 'llm',
    }))),
}))

vi.mock('@/utils', () => ({
  canFindTool: vi.fn((collectionId: string, providerId: string) => collectionId === providerId),
}))

function createToolData(overrides: Partial<ToolNodeType> = {}): ToolNodeType {
  return {
    title: 'Tool',
    desc: '',
    type: BlockEnum.Tool,
    provider_id: 'builtin-search',
    provider_type: CollectionType.builtIn,
    tool_name: 'google_search',
    tool_parameters: {},
    tool_configurations: {},
    ...overrides,
  } as ToolNodeType
}

function createToolCollection(overrides: Partial<ToolWithProvider> = {}): ToolWithProvider {
  return {
    id: 'builtin-search',
    name: 'Search',
    tools: [
      {
        name: 'google_search',
        parameters: [
          { name: 'query', label: { en_US: 'Query', zh_Hans: '查询' }, type: 'string', required: true, form: 'llm' },
          { name: 'api_key', label: { en_US: 'API Key' }, type: 'string', required: true, form: 'credential' },
        ],
      },
    ],
    allow_delete: true,
    is_team_authorization: false,
    ...overrides,
  } as unknown as ToolWithProvider
}

describe('getToolCheckParams', () => {
  it('should separate llm inputs from settings', () => {
    const result = getToolCheckParams(
      createToolData(),
      [createToolCollection()],
      [],
      [],
      'en_US',
    )

    expect(result.toolInputsSchema).toEqual([
      { label: 'Query', variable: 'query', type: 'string', required: true },
    ])
    expect(result.toolSettingSchema).toHaveLength(1)
    expect(result.toolSettingSchema[0].variable).toBe('api_key')
  })

  it('should mark notAuthed for builtin tools without team auth', () => {
    const result = getToolCheckParams(
      createToolData(),
      [createToolCollection()],
      [],
      [],
      'en_US',
    )

    expect(result.notAuthed).toBe(true)
  })

  it('should mark authed when is_team_authorization is true', () => {
    const result = getToolCheckParams(
      createToolData(),
      [createToolCollection({ is_team_authorization: true })],
      [],
      [],
      'en_US',
    )

    expect(result.notAuthed).toBe(false)
  })

  it('should use custom tools when provider_type is custom', () => {
    const customTool = createToolCollection({ id: 'custom-tool' })
    const result = getToolCheckParams(
      createToolData({ provider_id: 'custom-tool', provider_type: CollectionType.custom }),
      [],
      [customTool],
      [],
      'en_US',
    )

    expect(result.toolInputsSchema).toHaveLength(1)
  })

  it('should return empty schemas when tool is not found', () => {
    const result = getToolCheckParams(
      createToolData({ provider_id: 'non-existent' }),
      [],
      [],
      [],
      'en_US',
    )

    expect(result.toolInputsSchema).toEqual([])
    expect(result.toolSettingSchema).toEqual([])
  })

  it('should include language in result', () => {
    const result = getToolCheckParams(createToolData(), [createToolCollection()], [], [], 'zh_Hans')
    expect(result.language).toBe('zh_Hans')
  })

  it('should use workflowTools when provider_type is workflow', () => {
    const workflowTool = createToolCollection({ id: 'wf-tool' })
    const result = getToolCheckParams(
      createToolData({ provider_id: 'wf-tool', provider_type: CollectionType.workflow }),
      [],
      [],
      [workflowTool],
      'en_US',
    )

    expect(result.toolInputsSchema).toHaveLength(1)
  })

  it('should fallback to en_US label when language key is missing', () => {
    const tool = createToolCollection({
      tools: [
        {
          name: 'google_search',
          parameters: [
            { name: 'query', label: { en_US: 'Query' }, type: 'string', required: true, form: 'llm' },
          ],
        },
      ],
    } as Partial<ToolWithProvider>)

    const result = getToolCheckParams(
      createToolData(),
      [tool],
      [],
      [],
      'ja_JP',
    )

    expect(result.toolInputsSchema[0].label).toBe('Query')
  })
})

describe('CHUNK_TYPE_MAP', () => {
  it('should contain all expected chunk type mappings', () => {
    expect(CHUNK_TYPE_MAP).toEqual({
      general_chunks: 'GeneralStructureChunk',
      parent_child_chunks: 'ParentChildStructureChunk',
      qa_chunks: 'QAStructureChunk',
    })
  })
})

describe('wrapStructuredVarItem', () => {
  it('should wrap an output item into StructuredOutput format', () => {
    const outputItem = {
      name: 'result',
      value: { type: 'string', description: 'test' },
    }

    const result = wrapStructuredVarItem(outputItem, 'json_schema')

    expect(result.schema.type).toBe('object')
    expect(result.schema.additionalProperties).toBe(false)
    expect(result.schema.properties.result).toEqual({
      type: 'string',
      description: 'test',
      schemaType: 'json_schema',
    })
  })
})
