import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { CustomRunFormProps } from '@/app/components/workflow/nodes/data-source/types'
import type { Node, ToolWithProvider } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  clampNodePanelWidth,
  getCompressedNodePanelWidth,
  getCurrentDataSource,
  getCurrentToolCollection,
  getCurrentTriggerPlugin,
  getCustomRunForm,
  getMaxNodePanelWidth,
} from '../helpers'

describe('workflow-panel helpers', () => {
  const asToolList = (tools: Array<Partial<ToolWithProvider>>) => tools as ToolWithProvider[]
  const asTriggerList = (triggers: Array<Partial<TriggerWithProvider>>) => triggers as TriggerWithProvider[]
  const asNodeData = (data: Partial<Node['data']>) => data as Node['data']
  const createCustomRunFormProps = (payload: Partial<CustomRunFormProps['payload']>): CustomRunFormProps => ({
    nodeId: 'node-1',
    flowId: 'flow-1',
    flowType: 'app' as CustomRunFormProps['flowType'],
    payload: payload as CustomRunFormProps['payload'],
    setRunResult: vi.fn(),
    setIsRunAfterSingleRun: vi.fn(),
    isPaused: false,
    isRunAfterSingleRun: false,
    onSuccess: vi.fn(),
    onCancel: vi.fn(),
    appendNodeInspectVars: vi.fn(),
  })

  describe('panel width helpers', () => {
    it('should use the default max width when canvas width is unavailable', () => {
      expect(getMaxNodePanelWidth(undefined, 120)).toBe(720)
    })

    it('should clamp width into the supported panel range', () => {
      expect(clampNodePanelWidth(320, 800)).toBe(400)
      expect(clampNodePanelWidth(960, 800)).toBe(800)
      expect(clampNodePanelWidth(640, 800)).toBe(640)
    })

    it('should return a compressed width only when the canvas overflows', () => {
      expect(getCompressedNodePanelWidth(500, 1500, 300)).toBeUndefined()
      expect(getCompressedNodePanelWidth(900, 1200, 200)).toBe(600)
    })
  })

  describe('tool and provider lookup', () => {
    it('should prefer fresh built-in tool data when it is available', () => {
      const storeTools = [{ id: 'legacy/tool', allow_delete: false }]
      const queryTools = [{ id: 'provider/tool', allow_delete: true }]

      expect(getCurrentToolCollection(asToolList(queryTools), asToolList(storeTools), 'provider/tool')).toEqual(queryTools[0])
    })

    it('should fall back to store data when query data is unavailable', () => {
      const storeTools = [{ id: 'provider/tool', allow_delete: false }]

      expect(getCurrentToolCollection(undefined, asToolList(storeTools), 'provider/tool')).toEqual(storeTools[0])
    })

    it('should resolve the current trigger plugin and datasource only for matching node types', () => {
      const triggerData = asNodeData({ type: BlockEnum.TriggerPlugin, plugin_id: 'trigger-1' })
      const dataSourceData = asNodeData({ type: BlockEnum.DataSource, plugin_id: 'source-1', provider_type: 'remote' })
      const triggerPlugins = [{ plugin_id: 'trigger-1', id: '1' }]
      const dataSources = [{ plugin_id: 'source-1' }]

      expect(getCurrentTriggerPlugin(triggerData, asTriggerList(triggerPlugins))).toEqual(triggerPlugins[0])
      expect(getCurrentDataSource(dataSourceData, dataSources)).toEqual(dataSources[0])
      expect(getCurrentTriggerPlugin(asNodeData({ type: BlockEnum.Tool }), asTriggerList(triggerPlugins))).toBeUndefined()
      expect(getCurrentDataSource(asNodeData({ type: BlockEnum.Tool }), dataSources)).toBeUndefined()
    })
  })

  describe('custom run form fallback', () => {
    it('should return null for unsupported custom run form nodes', () => {
      const form = getCustomRunForm({
        ...createCustomRunFormProps({ type: BlockEnum.Tool }),
      })

      expect(form).toBeNull()
    })
  })
})
