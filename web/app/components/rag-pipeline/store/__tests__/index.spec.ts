import type { InputFieldEditorProps } from '../../components/panel/input-field/editor'
import type { RagPipelineSliceShape } from '../index'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'
import type { RAGPipelineVariables } from '@/models/pipeline'
import { describe, expect, it, vi } from 'vitest'
import { PipelineInputVarType } from '@/models/pipeline'

import { createRagPipelineSliceSlice } from '../index'

vi.mock('@/app/components/workflow/block-selector/utils', () => ({
  transformDataSourceToTool: (item: DataSourceItem) => ({
    ...item,
    transformed: true,
  }),
}))

type SliceCreatorParams = Parameters<typeof createRagPipelineSliceSlice>
const unusedGet = vi.fn() as unknown as SliceCreatorParams[1]
const unusedApi = vi.fn() as unknown as SliceCreatorParams[2]

function createSlice(mockSet = vi.fn()) {
  return createRagPipelineSliceSlice(mockSet as unknown as SliceCreatorParams[0], unusedGet, unusedApi)
}

describe('createRagPipelineSliceSlice', () => {
  const mockSet = vi.fn()

  describe('initial state', () => {
    it('should have empty pipelineId', () => {
      const slice = createSlice(mockSet)

      expect(slice.pipelineId).toBe('')
    })

    it('should have empty knowledgeName', () => {
      const slice = createSlice(mockSet)

      expect(slice.knowledgeName).toBe('')
    })

    it('should have showInputFieldPanel as false', () => {
      const slice = createSlice(mockSet)

      expect(slice.showInputFieldPanel).toBe(false)
    })

    it('should have showInputFieldPreviewPanel as false', () => {
      const slice = createSlice(mockSet)

      expect(slice.showInputFieldPreviewPanel).toBe(false)
    })

    it('should have inputFieldEditPanelProps as null', () => {
      const slice = createSlice(mockSet)

      expect(slice.inputFieldEditPanelProps).toBeNull()
    })

    it('should have empty nodesDefaultConfigs', () => {
      const slice = createSlice(mockSet)

      expect(slice.nodesDefaultConfigs).toEqual({})
    })

    it('should have empty ragPipelineVariables', () => {
      const slice = createSlice(mockSet)

      expect(slice.ragPipelineVariables).toEqual([])
    })

    it('should have empty dataSourceList', () => {
      const slice = createSlice(mockSet)

      expect(slice.dataSourceList).toEqual([])
    })

    it('should have isPreparingDataSource as false', () => {
      const slice = createSlice(mockSet)

      expect(slice.isPreparingDataSource).toBe(false)
    })
  })

  describe('setShowInputFieldPanel', () => {
    it('should call set with showInputFieldPanel true', () => {
      const slice = createSlice(mockSet)

      slice.setShowInputFieldPanel(true)

      expect(mockSet).toHaveBeenCalledWith(expect.any(Function))

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result).toEqual({ showInputFieldPanel: true })
    })

    it('should call set with showInputFieldPanel false', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)

      slice.setShowInputFieldPanel(false)

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result).toEqual({ showInputFieldPanel: false })
    })
  })

  describe('setShowInputFieldPreviewPanel', () => {
    it('should call set with showInputFieldPreviewPanel true', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)

      slice.setShowInputFieldPreviewPanel(true)

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result).toEqual({ showInputFieldPreviewPanel: true })
    })

    it('should call set with showInputFieldPreviewPanel false', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)

      slice.setShowInputFieldPreviewPanel(false)

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result).toEqual({ showInputFieldPreviewPanel: false })
    })
  })

  describe('setInputFieldEditPanelProps', () => {
    it('should call set with inputFieldEditPanelProps object', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)
      const props = { onClose: vi.fn(), onSubmit: vi.fn() } as unknown as InputFieldEditorProps

      slice.setInputFieldEditPanelProps(props)

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result).toEqual({ inputFieldEditPanelProps: props })
    })

    it('should call set with inputFieldEditPanelProps null', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)

      slice.setInputFieldEditPanelProps(null)

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result).toEqual({ inputFieldEditPanelProps: null })
    })
  })

  describe('setNodesDefaultConfigs', () => {
    it('should call set with nodesDefaultConfigs', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)
      const configs: Record<string, unknown> = { node1: { key: 'value' } }

      slice.setNodesDefaultConfigs(configs)

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result).toEqual({ nodesDefaultConfigs: configs })
    })

    it('should call set with empty nodesDefaultConfigs', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)

      slice.setNodesDefaultConfigs({})

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result).toEqual({ nodesDefaultConfigs: {} })
    })
  })

  describe('setRagPipelineVariables', () => {
    it('should call set with ragPipelineVariables', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)
      const variables: RAGPipelineVariables = [
        { type: PipelineInputVarType.textInput, variable: 'var1', label: 'Var 1', required: true, belong_to_node_id: 'node-1' },
      ]

      slice.setRagPipelineVariables(variables)

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result).toEqual({ ragPipelineVariables: variables })
    })

    it('should call set with empty ragPipelineVariables', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)

      slice.setRagPipelineVariables([])

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result).toEqual({ ragPipelineVariables: [] })
    })
  })

  describe('setDataSourceList', () => {
    it('should transform and set dataSourceList', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)
      const dataSourceList: DataSourceItem[] = [
        { name: 'source1', key: 'key1' } as unknown as DataSourceItem,
        { name: 'source2', key: 'key2' } as unknown as DataSourceItem,
      ]

      slice.setDataSourceList(dataSourceList)

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result.dataSourceList).toHaveLength(2)
      expect(result.dataSourceList![0]).toEqual({ name: 'source1', key: 'key1', transformed: true })
      expect(result.dataSourceList![1]).toEqual({ name: 'source2', key: 'key2', transformed: true })
    })

    it('should set empty dataSourceList', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)

      slice.setDataSourceList([])

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result.dataSourceList).toEqual([])
    })
  })

  describe('setIsPreparingDataSource', () => {
    it('should call set with isPreparingDataSource true', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)

      slice.setIsPreparingDataSource(true)

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result).toEqual({ isPreparingDataSource: true })
    })

    it('should call set with isPreparingDataSource false', () => {
      mockSet.mockClear()
      const slice = createSlice(mockSet)

      slice.setIsPreparingDataSource(false)

      const setterFn = mockSet.mock.calls[0][0] as () => Partial<RagPipelineSliceShape>
      const result = setterFn()
      expect(result).toEqual({ isPreparingDataSource: false })
    })
  })
})

describe('RagPipelineSliceShape type', () => {
  it('should define all required properties', () => {
    const slice = createSlice()

    expect(slice).toHaveProperty('pipelineId')
    expect(slice).toHaveProperty('knowledgeName')
    expect(slice).toHaveProperty('showInputFieldPanel')
    expect(slice).toHaveProperty('setShowInputFieldPanel')
    expect(slice).toHaveProperty('showInputFieldPreviewPanel')
    expect(slice).toHaveProperty('setShowInputFieldPreviewPanel')
    expect(slice).toHaveProperty('inputFieldEditPanelProps')
    expect(slice).toHaveProperty('setInputFieldEditPanelProps')
    expect(slice).toHaveProperty('nodesDefaultConfigs')
    expect(slice).toHaveProperty('setNodesDefaultConfigs')
    expect(slice).toHaveProperty('ragPipelineVariables')
    expect(slice).toHaveProperty('setRagPipelineVariables')
    expect(slice).toHaveProperty('dataSourceList')
    expect(slice).toHaveProperty('setDataSourceList')
    expect(slice).toHaveProperty('isPreparingDataSource')
    expect(slice).toHaveProperty('setIsPreparingDataSource')
  })

  it('should have all setters as functions', () => {
    const slice = createSlice()

    expect(typeof slice.setShowInputFieldPanel).toBe('function')
    expect(typeof slice.setShowInputFieldPreviewPanel).toBe('function')
    expect(typeof slice.setInputFieldEditPanelProps).toBe('function')
    expect(typeof slice.setNodesDefaultConfigs).toBe('function')
    expect(typeof slice.setRagPipelineVariables).toBe('function')
    expect(typeof slice.setDataSourceList).toBe('function')
    expect(typeof slice.setIsPreparingDataSource).toBe('function')
  })
})
