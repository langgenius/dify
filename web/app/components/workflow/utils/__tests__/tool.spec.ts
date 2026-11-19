import type { ToolNodeType } from '../../nodes/tool/types'
import type { ToolWithProvider } from '../../types'
import { CollectionType } from '@/app/components/tools/types'
import { createTool, createToolProvider } from '../../block-selector/__tests__/factories'
import { BlockEnum } from '../../types'
import { getToolCheckParams, wrapStructuredVarItem } from '../tool'

function createToolData(overrides: Partial<ToolNodeType> = {}): ToolNodeType {
  return {
    title: 'Tool',
    desc: '',
    type: BlockEnum.Tool,
    provider_id: 'builtin-search',
    provider_type: CollectionType.builtIn,
    provider_name: 'Search',
    tool_label: 'Google Search',
    tool_name: 'google_search',
    tool_parameters: {},
    tool_configurations: {},
    ...overrides,
  }
}

function createToolCollection(overrides: Partial<ToolWithProvider> = {}): ToolWithProvider {
  return createToolProvider({
    id: 'builtin-search',
    name: 'Search',
    allow_delete: true,
    is_team_authorization: false,
    tools: [
      {
        ...createTool('google_search', 'Google Search'),
        parameters: [
          {
            name: 'query',
            label: { en_US: 'Query', zh_Hans: '查询' },
            type: 'string',
            required: true,
            form: 'llm',
            human_description: { en_US: '', zh_Hans: '' },
            llm_description: '',
            multiple: false,
          },
          {
            name: 'api_key',
            label: { en_US: 'API Key', zh_Hans: 'API Key' },
            type: 'string',
            required: true,
            form: 'credential',
            human_description: { en_US: '', zh_Hans: '' },
            llm_description: '',
            multiple: false,
          },
        ],
      },
    ],
    ...overrides,
  })
}

describe('getToolCheckParams', () => {
  it('should separate llm inputs from settings', () => {
    const result = getToolCheckParams(createToolData(), [createToolCollection()], [], [], 'en_US')

    expect(result.toolInputsSchema).toEqual([
      { label: 'Query', variable: 'query', type: 'text-input', required: true },
    ])
    expect(result.notAuthed).toBe(true)
    expect(result.toolSettingSchema).toHaveLength(1)
    expect(result.toolSettingSchema[0]!.variable).toBe('api_key')
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

    expect(result.toolInputsSchema).toEqual([
      { label: 'Query', variable: 'query', type: 'text-input', required: true },
    ])
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

  it('should use workflowTools when provider_type is workflow', () => {
    const workflowTool = createToolCollection({ id: 'wf-tool' })
    const result = getToolCheckParams(
      createToolData({ provider_id: 'wf-tool', provider_type: CollectionType.workflow }),
      [],
      [],
      [workflowTool],
      'en_US',
    )

    expect(result.toolInputsSchema).toEqual([
      { label: 'Query', variable: 'query', type: 'text-input', required: true },
    ])
  })

  it('should fallback to en_US label when language key is missing', () => {
    const tool = createToolCollection()

    const result = getToolCheckParams(createToolData(), [tool], [], [], 'ja_JP')

    expect(result.toolInputsSchema[0]!.label).toBe('Query')
    const localized = getToolCheckParams(createToolData(), [tool], [], [], 'zh_Hans')
    expect(localized.toolInputsSchema[0]!.label).toBe('查询')
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
