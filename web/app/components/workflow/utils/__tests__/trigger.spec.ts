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
  } as PluginTriggerNodeType
}

function createTriggerProvider(overrides: Partial<TriggerWithProvider> = {}): TriggerWithProvider {
  return {
    id: 'provider-1',
    name: 'my-provider',
    plugin_id: 'plugin-1',
    events: [
      {
        name: 'on_message',
        label: { en_US: 'On Message', zh_Hans: '收到消息' },
        parameters: [
          {
            name: 'channel',
            label: { en_US: 'Channel', zh_Hans: '频道' },
            required: true,
          },
          {
            name: 'filter',
            label: { en_US: 'Filter' },
            required: false,
          },
        ],
      },
    ],
    ...overrides,
  } as unknown as TriggerWithProvider
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
    const result = getTriggerCheckParams(
      createTriggerData(),
      [createTriggerProvider()],
      'en_US',
    )

    expect(result.isReadyForCheckValid).toBe(true)
    expect(result.triggerInputsSchema).toEqual([
      { variable: 'channel', label: 'Channel', required: true },
      { variable: 'filter', label: 'Filter', required: false },
    ])
  })

  it('should use the requested language for labels', () => {
    const result = getTriggerCheckParams(
      createTriggerData(),
      [createTriggerProvider()],
      'zh_Hans',
    )

    expect(result.triggerInputsSchema[0].label).toBe('频道')
  })

  it('should fall back to en_US when language label is missing', () => {
    const result = getTriggerCheckParams(
      createTriggerData(),
      [createTriggerProvider()],
      'ja_JP',
    )

    expect(result.triggerInputsSchema[0].label).toBe('Channel')
  })

  it('should fall back to parameter name when no labels exist', () => {
    const provider = createTriggerProvider({
      events: [{
        name: 'on_message',
        label: { en_US: 'On Message' },
        parameters: [{ name: 'raw_param' }],
      }],
    } as Partial<TriggerWithProvider>)

    const result = getTriggerCheckParams(createTriggerData(), [provider], 'en_US')

    expect(result.triggerInputsSchema[0].label).toBe('raw_param')
  })

  it('should match provider by provider_id', () => {
    const trigger = createTriggerData({ provider_name: 'different-name', provider_id: 'provider-1' })
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
