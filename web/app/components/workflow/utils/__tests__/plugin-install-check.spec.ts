import type { TriggerWithProvider } from '../../block-selector/types'
import type { CommonNodeType, ToolWithProvider } from '../../types'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { CollectionType } from '@/app/components/tools/types'
import { BlockEnum } from '../../types'
import {
  isNodePluginMissing,
  matchDataSource,
  matchToolInCollection,
  matchTriggerProvider,
} from '../plugin-install-check'

const createTool = (overrides: Partial<ToolWithProvider> = {}): ToolWithProvider =>
  ({
    id: 'langgenius/search/search',
    name: 'search',
    plugin_id: 'plugin-search',
    provider: 'search-provider',
    plugin_unique_identifier: 'plugin-search@1.0.0',
    ...overrides,
  }) as ToolWithProvider

const createTriggerProvider = (overrides: Partial<TriggerWithProvider> = {}): TriggerWithProvider =>
  ({
    id: 'trigger-provider-id',
    name: 'trigger-provider',
    plugin_id: 'trigger-plugin',
    ...overrides,
  }) as TriggerWithProvider

describe('plugin install check', () => {
  describe('matchToolInCollection', () => {
    const collection = [createTool()]

    it('should match a tool by plugin id', () => {
      expect(matchToolInCollection(collection, { plugin_id: 'plugin-search' })).toEqual(
        collection[0],
      )
    })

    it('should match a tool by legacy provider id', () => {
      expect(matchToolInCollection(collection, { provider_id: 'search' })).toEqual(collection[0])
    })

    it('should match a tool by provider name', () => {
      expect(matchToolInCollection(collection, { provider_name: 'search' })).toEqual(collection[0])
    })

    it('should return undefined when no tool matches', () => {
      expect(matchToolInCollection(collection, { plugin_id: 'missing-plugin' })).toBeUndefined()
    })
  })

  describe('matchTriggerProvider', () => {
    const providers = [createTriggerProvider()]

    it('should match a trigger provider by name', () => {
      expect(matchTriggerProvider(providers, { provider_name: 'trigger-provider' })).toEqual(
        providers[0],
      )
    })

    it('should match a trigger provider by id', () => {
      expect(matchTriggerProvider(providers, { provider_id: 'trigger-provider-id' })).toEqual(
        providers[0],
      )
    })

    it('should match a trigger provider by plugin id', () => {
      expect(matchTriggerProvider(providers, { plugin_id: 'trigger-plugin' })).toEqual(providers[0])
    })
  })

  describe('matchDataSource', () => {
    const dataSources = [
      createDatasourceProvider({
        provider: 'knowledge-provider',
        plugin_id: 'knowledge-plugin',
        plugin_unique_identifier: 'knowledge-plugin@1.0.0',
      }),
    ]

    it('should match a data source by unique identifier', () => {
      expect(
        matchDataSource(dataSources, { plugin_unique_identifier: 'knowledge-plugin@1.0.0' }),
      ).toEqual(dataSources[0])
    })

    it('should match a data source by plugin id', () => {
      expect(matchDataSource(dataSources, { plugin_id: 'knowledge-plugin' })).toEqual(
        dataSources[0],
      )
    })

    it('should match a data source by provider name', () => {
      expect(matchDataSource(dataSources, { provider_name: 'knowledge-provider' })).toEqual(
        dataSources[0],
      )
    })

    it('keeps plugin identity authoritative when another plugin has the same provider name', () => {
      const fork = createDatasourceProvider({
        provider: 'notion',
        plugin_id: 'acme/notion',
        plugin_unique_identifier: 'acme/notion:1.0.0',
        is_authorized: false,
      })
      const official = createDatasourceProvider({
        provider: 'notion',
        plugin_id: 'langgenius/notion',
        plugin_unique_identifier: 'langgenius/notion:2.0.0',
        is_authorized: true,
      })
      const savedNode = {
        plugin_id: official.plugin_id,
        plugin_unique_identifier: official.plugin_unique_identifier,
        provider_name: 'notion',
      }
      expect(matchDataSource([fork, official], savedNode)).toBe(official)
      expect(
        matchDataSource([fork, official], {
          ...savedNode,
          plugin_unique_identifier: 'langgenius/notion:1.0.0',
        }),
      ).toBe(official)
      expect(matchDataSource([fork], savedNode)).toBeUndefined()
      expect(
        matchDataSource([fork], {
          plugin_unique_identifier: official.plugin_unique_identifier,
          provider_name: 'notion',
        }),
      ).toBeUndefined()
      expect(
        isNodePluginMissing(
          { ...savedNode, type: BlockEnum.DataSource, title: 'Notion', desc: '' },
          { dataSourceList: [fork] },
        ),
      ).toBe(true)
    })
  })

  describe('isNodePluginMissing', () => {
    it('should report missing tool plugins when the collection is loaded but unmatched', () => {
      const node = {
        type: BlockEnum.Tool,
        title: 'Tool',
        desc: '',
        provider_type: CollectionType.builtIn,
        provider_id: 'missing-provider',
        plugin_unique_identifier: 'missing-plugin@1.0.0',
      } as CommonNodeType

      expect(isNodePluginMissing(node, { builtInTools: [createTool()] })).toBe(true)
    })

    it('should keep tool nodes installable when the collection has not loaded yet', () => {
      const node = {
        type: BlockEnum.Tool,
        title: 'Tool',
        desc: '',
        provider_type: CollectionType.builtIn,
        provider_id: 'missing-provider',
        plugin_unique_identifier: 'missing-plugin@1.0.0',
      } as CommonNodeType

      expect(isNodePluginMissing(node, { builtInTools: undefined })).toBe(false)
    })

    it('should ignore unmatched tool nodes without plugin identifiers', () => {
      const node = {
        type: BlockEnum.Tool,
        title: 'Tool',
        desc: '',
        provider_type: CollectionType.builtIn,
        provider_id: 'missing-provider',
      } as CommonNodeType

      expect(isNodePluginMissing(node, { builtInTools: [createTool()] })).toBe(false)
    })

    it('should report missing trigger plugins when no provider matches', () => {
      const node = {
        type: BlockEnum.TriggerPlugin,
        title: 'Trigger',
        desc: '',
        provider_id: 'missing-trigger',
        plugin_unique_identifier: 'trigger-plugin@1.0.0',
      } as CommonNodeType

      expect(isNodePluginMissing(node, { triggerPlugins: [createTriggerProvider()] })).toBe(true)
    })

    it('should keep trigger plugin nodes installable when the provider list has not loaded yet', () => {
      const node = {
        type: BlockEnum.TriggerPlugin,
        title: 'Trigger',
        desc: '',
        provider_id: 'missing-trigger',
        plugin_unique_identifier: 'trigger-plugin@1.0.0',
      } as CommonNodeType

      expect(isNodePluginMissing(node, { triggerPlugins: undefined })).toBe(false)
    })

    it('should report missing data source plugins when the list is loaded but unmatched', () => {
      const node = {
        type: BlockEnum.DataSource,
        title: 'Data Source',
        desc: '',
        provider_name: 'missing-provider',
        plugin_unique_identifier: 'missing-data-source@1.0.0',
      } as CommonNodeType

      expect(isNodePluginMissing(node, { dataSourceList: [createDatasourceProvider()] })).toBe(true)
    })

    it('should keep data source nodes installable when the list has not loaded yet', () => {
      const node = {
        type: BlockEnum.DataSource,
        title: 'Data Source',
        desc: '',
        provider_name: 'missing-provider',
        plugin_unique_identifier: 'missing-data-source@1.0.0',
      } as CommonNodeType

      expect(isNodePluginMissing(node, { dataSourceList: undefined })).toBe(false)
    })

    it('should return false for unsupported node types', () => {
      const node = {
        type: BlockEnum.LLM,
        title: 'LLM',
        desc: '',
      } as CommonNodeType

      expect(isNodePluginMissing(node, {})).toBe(false)
    })
  })
})
