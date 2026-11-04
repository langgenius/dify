import type { TriggerWithProvider } from '../../block-selector/types'
import type { PluginTriggerNodeType } from '../../nodes/trigger-plugin/types'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '../../types'
import { getTriggerCheckParams } from '../trigger'

function createTriggerData(overrides: Partial<PluginTriggerNodeType> = {}): PluginTriggerNodeType {
  return {
    title: 'Trigger',
    desc: '',
    type: BlockEnum.TriggerPlugin,
    provider_id: 'provider-1',
    provider_type: CollectionType.builtIn,
    provider_name: 'my-provider',
    event_name: 'on_message',
    event_label: 'On Message',
    event_parameters: {},
    event_configurations: {},
    output_schema: {},
    ...overrides,
  }
}

type Parameter = TriggerWithProvider['events'][number]['parameters'][number]
const createParameter = (overrides: Partial<Parameter> = {}): Parameter => ({
  name: 'channel',
  label: { en_US: 'Channel', zh_Hans: '频道' },
  human_description: { en_US: '', zh_Hans: '' },
  type: 'string',
  form: 'form',
  llm_description: '',
  required: true,
  multiple: false,
  default: '',
  ...overrides,
})
function createTriggerProvider(overrides: Partial<TriggerWithProvider> = {}): TriggerWithProvider {
  return {
    id: 'provider-1',
    name: 'my-provider',
    plugin_id: 'plugin-1',
    author: 'Dify',
    description: { en_US: '', zh_Hans: '' },
    icon: 'icon',
    label: { en_US: 'Provider', zh_Hans: 'Provider' },
    type: CollectionType.trigger,
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: [],
    plugin_unique_identifier: 'plugin-1@1.0.0',
    meta: { version: '1.0.0' },
    supported_creation_methods: [],
    events: [
      {
        name: 'on_message',
        author: 'Dify',
        label: { en_US: 'On Message', zh_Hans: '收到消息' },
        description: { en_US: '', zh_Hans: '' },
        labels: [],
        output_schema: {},
        parameters: [
          createParameter(),
          createParameter({
            name: 'filter',
            label: { en_US: 'Filter', zh_Hans: '' },
            required: false,
          }),
        ],
      },
    ],
    ...overrides,
  }
}

describe('getTriggerCheckParams', () => {
  it('should return empty schema when triggerProviders is undefined', () => {
    const result = getTriggerCheckParams(createTriggerData(), undefined, 'en_US')

    expect(result).toEqual({
      triggerInputsSchema: [],
      isReadyForCheckValid: false,
    })
  })

  it('should match provider by name and extract parameters', () => {
    const result = getTriggerCheckParams(createTriggerData(), [createTriggerProvider()], 'en_US')

    expect(result.isReadyForCheckValid).toBe(true)
    expect(result.triggerInputsSchema).toEqual([
      { variable: 'channel', label: 'Channel', required: true },
      { variable: 'filter', label: 'Filter', required: false },
    ])
  })

  it('should use the requested language for labels', () => {
    const result = getTriggerCheckParams(createTriggerData(), [createTriggerProvider()], 'zh_Hans')

    expect(result.triggerInputsSchema.map((field) => field.label)).toEqual(['频道', 'Filter'])
  })

  it('should fall back to en_US when language label is missing', () => {
    const result = getTriggerCheckParams(createTriggerData(), [createTriggerProvider()], 'ja_JP')

    expect(result.triggerInputsSchema[0]!.label).toBe('Channel')
  })

  it('should fall back to parameter name when no labels exist', () => {
    const provider = createTriggerProvider()
    provider.events[0]!.parameters = [
      createParameter({ name: 'raw_param', label: { en_US: '', zh_Hans: '' } }),
    ]

    const result = getTriggerCheckParams(createTriggerData(), [provider], 'en_US')

    expect(result.triggerInputsSchema[0]!.label).toBe('raw_param')
  })

  it('should match provider by provider_id', () => {
    const trigger = createTriggerData({
      provider_name: 'different-name',
      provider_id: 'provider-1',
    })
    const provider = createTriggerProvider({ name: 'other-name', id: 'provider-1' })

    const result = getTriggerCheckParams(trigger, [provider], 'en_US')
    expect(result.isReadyForCheckValid).toBe(true)
  })

  it('should match provider by plugin_id', () => {
    const trigger = createTriggerData({ provider_name: 'x', provider_id: 'plugin-1' })
    const provider = createTriggerProvider({ name: 'y', id: 'z', plugin_id: 'plugin-1' })

    const result = getTriggerCheckParams(trigger, [provider], 'en_US')
    expect(result.isReadyForCheckValid).toBe(true)
  })

  it('should return empty schema when event is not found', () => {
    const trigger = createTriggerData({ event_name: 'non_existent_event' })

    const result = getTriggerCheckParams(trigger, [createTriggerProvider()], 'en_US')
    expect(result.triggerInputsSchema).toEqual([])
    expect(result.isReadyForCheckValid).toBe(true)
  })
})
