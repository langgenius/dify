import type { RAGPipelineVariables, VAR_TYPE_MAP } from '@/models/pipeline'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { Resolution, TransferMethod } from '@/types/app'
import { FlowType } from '@/types/common'

// ============================================================================
// Import hooks after mocks
// ============================================================================

import {
  useAvailableNodesMetaData,
  useDSL,
  useGetRunAndTraceUrl,
  useInputFieldPanel,
  useNodesSyncDraft,
  usePipelineInit,
  usePipelineRefreshDraft,
  usePipelineRun,
  usePipelineStartRun,
} from './index'
import { useConfigsMap } from './use-configs-map'
import { useConfigurations, useInitialData } from './use-input-fields'
import { usePipelineTemplate } from './use-pipeline-template'

// ============================================================================
// Mocks
// ============================================================================

// Mock the workflow store
const _mockGetState = vi.fn()
const mockUseStore = vi.fn()
const mockUseWorkflowStore = vi.fn()

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => mockUseStore(selector),
  useWorkflowStore: () => mockUseWorkflowStore(),
}))

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock toast context
const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

// Mock event emitter context
const mockEventEmit = vi.fn()
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mockEventEmit,
    },
  }),
}))

// Mock i18n docLink
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

// Mock workflow constants
vi.mock('@/app/components/workflow/constants', () => ({
  DSL_EXPORT_CHECK: 'DSL_EXPORT_CHECK',
  WORKFLOW_DATA_UPDATE: 'WORKFLOW_DATA_UPDATE',
  START_INITIAL_POSITION: { x: 100, y: 100 },
}))

// Mock workflow constants/node
vi.mock('@/app/components/workflow/constants/node', () => ({
  WORKFLOW_COMMON_NODES: [
    {
      metaData: { type: BlockEnum.Start },
      defaultValue: { type: BlockEnum.Start },
    },
    {
      metaData: { type: BlockEnum.End },
      defaultValue: { type: BlockEnum.End },
    },
  ],
}))

// Mock data source defaults
vi.mock('@/app/components/workflow/nodes/data-source-empty/default', () => ({
  default: {
    metaData: { type: BlockEnum.DataSourceEmpty },
    defaultValue: { type: BlockEnum.DataSourceEmpty },
  },
}))

vi.mock('@/app/components/workflow/nodes/data-source/default', () => ({
  default: {
    metaData: { type: BlockEnum.DataSource },
    defaultValue: { type: BlockEnum.DataSource },
  },
}))

vi.mock('@/app/components/workflow/nodes/knowledge-base/default', () => ({
  default: {
    metaData: { type: BlockEnum.KnowledgeBase },
    defaultValue: { type: BlockEnum.KnowledgeBase },
  },
}))

// Mock workflow utils with all needed exports
vi.mock('@/app/components/workflow/utils', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    generateNewNode: ({ id, data, position }: { id: string, data: object, position: { x: number, y: number } }) => ({
      newNode: { id, data, position, type: 'custom' },
    }),
  }
})

// Mock pipeline service
const mockExportPipelineConfig = vi.fn()
vi.mock('@/service/use-pipeline', () => ({
  useExportPipelineDSL: () => ({
    mutateAsync: mockExportPipelineConfig,
  }),
}))

// Mock workflow service
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: vi.fn().mockResolvedValue({
    graph: { nodes: [], edges: [], viewport: {} },
    environment_variables: [],
  }),
}))

// ============================================================================
// Tests
// ============================================================================

describe('useConfigsMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseStore.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
      const state = {
        pipelineId: 'test-pipeline-id',
        fileUploadConfig: { max_file_size: 10 },
      }
      return selector(state)
    })
  })

  it('should return config map with correct flowId', () => {
    const { result } = renderHook(() => useConfigsMap())

    expect(result.current.flowId).toBe('test-pipeline-id')
  })

  it('should return config map with correct flowType', () => {
    const { result } = renderHook(() => useConfigsMap())

    expect(result.current.flowType).toBe(FlowType.ragPipeline)
  })

  it('should return file settings with image config', () => {
    const { result } = renderHook(() => useConfigsMap())

    expect(result.current.fileSettings.image).toEqual({
      enabled: false,
      detail: Resolution.high,
      number_limits: 3,
      transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
    })
  })

  it('should include fileUploadConfig from store', () => {
    const { result } = renderHook(() => useConfigsMap())

    expect(result.current.fileSettings.fileUploadConfig).toEqual({ max_file_size: 10 })
  })
})

describe('useGetRunAndTraceUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseWorkflowStore.mockReturnValue({
      getState: () => ({
        pipelineId: 'pipeline-123',
      }),
    })
  })

  it('should return getWorkflowRunAndTraceUrl function', () => {
    const { result } = renderHook(() => useGetRunAndTraceUrl())

    expect(result.current.getWorkflowRunAndTraceUrl).toBeDefined()
    expect(typeof result.current.getWorkflowRunAndTraceUrl).toBe('function')
  })

  it('should generate correct run URL', () => {
    const { result } = renderHook(() => useGetRunAndTraceUrl())

    const { runUrl } = result.current.getWorkflowRunAndTraceUrl('run-456')

    expect(runUrl).toBe('/rag/pipelines/pipeline-123/workflow-runs/run-456')
  })

  it('should generate correct trace URL', () => {
    const { result } = renderHook(() => useGetRunAndTraceUrl())

    const { traceUrl } = result.current.getWorkflowRunAndTraceUrl('run-456')

    expect(traceUrl).toBe('/rag/pipelines/pipeline-123/workflow-runs/run-456/node-executions')
  })
})

describe('useInputFieldPanel', () => {
  const mockSetShowInputFieldPanel = vi.fn()
  const mockSetShowInputFieldPreviewPanel = vi.fn()
  const mockSetInputFieldEditPanelProps = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseStore.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
      const state = {
        showInputFieldPreviewPanel: false,
        inputFieldEditPanelProps: null,
      }
      return selector(state)
    })
    mockUseWorkflowStore.mockReturnValue({
      getState: () => ({
        showInputFieldPreviewPanel: false,
        setShowInputFieldPanel: mockSetShowInputFieldPanel,
        setShowInputFieldPreviewPanel: mockSetShowInputFieldPreviewPanel,
        setInputFieldEditPanelProps: mockSetInputFieldEditPanelProps,
      }),
    })
  })

  it('should return isPreviewing as false when showInputFieldPreviewPanel is false', () => {
    const { result } = renderHook(() => useInputFieldPanel())

    expect(result.current.isPreviewing).toBe(false)
  })

  it('should return isPreviewing as true when showInputFieldPreviewPanel is true', () => {
    mockUseStore.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
      const state = {
        showInputFieldPreviewPanel: true,
        inputFieldEditPanelProps: null,
      }
      return selector(state)
    })

    const { result } = renderHook(() => useInputFieldPanel())

    expect(result.current.isPreviewing).toBe(true)
  })

  it('should return isEditing as false when inputFieldEditPanelProps is null', () => {
    const { result } = renderHook(() => useInputFieldPanel())

    expect(result.current.isEditing).toBe(false)
  })

  it('should return isEditing as true when inputFieldEditPanelProps exists', () => {
    mockUseStore.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
      const state = {
        showInputFieldPreviewPanel: false,
        inputFieldEditPanelProps: { some: 'props' },
      }
      return selector(state)
    })

    const { result } = renderHook(() => useInputFieldPanel())

    expect(result.current.isEditing).toBe(true)
  })

  it('should call all setters when closeAllInputFieldPanels is called', () => {
    const { result } = renderHook(() => useInputFieldPanel())

    act(() => {
      result.current.closeAllInputFieldPanels()
    })

    expect(mockSetShowInputFieldPanel).toHaveBeenCalledWith(false)
    expect(mockSetShowInputFieldPreviewPanel).toHaveBeenCalledWith(false)
    expect(mockSetInputFieldEditPanelProps).toHaveBeenCalledWith(null)
  })

  it('should toggle preview panel when toggleInputFieldPreviewPanel is called', () => {
    const { result } = renderHook(() => useInputFieldPanel())

    act(() => {
      result.current.toggleInputFieldPreviewPanel()
    })

    expect(mockSetShowInputFieldPreviewPanel).toHaveBeenCalledWith(true)
  })

  it('should set edit panel props when toggleInputFieldEditPanel is called', () => {
    const { result } = renderHook(() => useInputFieldPanel())
    const editContent = { type: 'edit', data: {} }

    act(() => {
      // eslint-disable-next-line ts/no-explicit-any
      result.current.toggleInputFieldEditPanel(editContent as any)
    })

    expect(mockSetInputFieldEditPanelProps).toHaveBeenCalledWith(editContent)
  })
})

describe('useInitialData', () => {
  it('should return empty object for empty variables', () => {
    const { result } = renderHook(() => useInitialData([], undefined))

    expect(result.current).toEqual({})
  })

  it('should handle text input type with default value', () => {
    const variables: RAGPipelineVariables = [
      {
        type: 'text-input' as keyof typeof VAR_TYPE_MAP,
        variable: 'textVar',
        label: 'Text',
        required: false,
        default_value: 'default text',
        belong_to_node_id: 'node-1',
      },
    ]

    const { result } = renderHook(() => useInitialData(variables, undefined))

    expect(result.current.textVar).toBe('default text')
  })

  it('should use lastRunInputData over default value', () => {
    const variables: RAGPipelineVariables = [
      {
        type: 'text-input' as keyof typeof VAR_TYPE_MAP,
        variable: 'textVar',
        label: 'Text',
        required: false,
        default_value: 'default text',
        belong_to_node_id: 'node-1',
      },
    ]

    const { result } = renderHook(() => useInitialData(variables, { textVar: 'last run value' }))

    expect(result.current.textVar).toBe('last run value')
  })

  it('should handle number input type with default 0', () => {
    const variables: RAGPipelineVariables = [
      {
        type: 'number' as keyof typeof VAR_TYPE_MAP,
        variable: 'numVar',
        label: 'Number',
        required: false,
        belong_to_node_id: 'node-1',
      },
    ]

    const { result } = renderHook(() => useInitialData(variables, undefined))

    expect(result.current.numVar).toBe(0)
  })

  it('should handle file type with default empty array', () => {
    const variables: RAGPipelineVariables = [
      {
        type: 'file' as keyof typeof VAR_TYPE_MAP,
        variable: 'fileVar',
        label: 'File',
        required: false,
        belong_to_node_id: 'node-1',
      },
    ]

    const { result } = renderHook(() => useInitialData(variables, undefined))

    expect(result.current.fileVar).toEqual([])
  })
})

describe('useConfigurations', () => {
  it('should return empty array for empty variables', () => {
    const { result } = renderHook(() => useConfigurations([]))

    expect(result.current).toEqual([])
  })

  it('should transform variables to configurations', () => {
    const variables: RAGPipelineVariables = [
      {
        type: 'text-input' as keyof typeof VAR_TYPE_MAP,
        variable: 'textVar',
        label: 'Text Label',
        required: true,
        max_length: 100,
        placeholder: 'Enter text',
        tooltips: 'Help text',
        belong_to_node_id: 'node-1',
      },
    ]

    const { result } = renderHook(() => useConfigurations(variables))

    expect(result.current.length).toBe(1)
    expect(result.current[0].variable).toBe('textVar')
    expect(result.current[0].label).toBe('Text Label')
    expect(result.current[0].required).toBe(true)
    expect(result.current[0].maxLength).toBe(100)
    expect(result.current[0].placeholder).toBe('Enter text')
    expect(result.current[0].tooltip).toBe('Help text')
  })

  it('should transform options correctly', () => {
    const variables: RAGPipelineVariables = [
      {
        type: 'select' as keyof typeof VAR_TYPE_MAP,
        variable: 'selectVar',
        label: 'Select',
        required: false,
        options: ['option1', 'option2', 'option3'],
        belong_to_node_id: 'node-1',
      },
    ]

    const { result } = renderHook(() => useConfigurations(variables))

    expect(result.current[0].options).toEqual([
      { label: 'option1', value: 'option1' },
      { label: 'option2', value: 'option2' },
      { label: 'option3', value: 'option3' },
    ])
  })
})

describe('useAvailableNodesMetaData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return nodes array', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())

    expect(result.current.nodes).toBeDefined()
    expect(Array.isArray(result.current.nodes)).toBe(true)
  })

  it('should return nodesMap object', () => {
    const { result } = renderHook(() => useAvailableNodesMetaData())

    expect(result.current.nodesMap).toBeDefined()
    expect(typeof result.current.nodesMap).toBe('object')
  })
})

describe('usePipelineTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return nodes array with knowledge base node', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.nodes).toBeDefined()
    expect(Array.isArray(result.current.nodes)).toBe(true)
    expect(result.current.nodes.length).toBe(1)
  })

  it('should return empty edges array', () => {
    const { result } = renderHook(() => usePipelineTemplate())

    expect(result.current.edges).toEqual([])
  })
})

describe('useDSL', () => {
  it('should be defined and exported', () => {
    expect(useDSL).toBeDefined()
    expect(typeof useDSL).toBe('function')
  })
})

describe('exports', () => {
  it('should export useAvailableNodesMetaData', () => {
    expect(useAvailableNodesMetaData).toBeDefined()
  })

  it('should export useDSL', () => {
    expect(useDSL).toBeDefined()
  })

  it('should export useGetRunAndTraceUrl', () => {
    expect(useGetRunAndTraceUrl).toBeDefined()
  })

  it('should export useInputFieldPanel', () => {
    expect(useInputFieldPanel).toBeDefined()
  })

  it('should export useNodesSyncDraft', () => {
    expect(useNodesSyncDraft).toBeDefined()
  })

  it('should export usePipelineInit', () => {
    expect(usePipelineInit).toBeDefined()
  })

  it('should export usePipelineRefreshDraft', () => {
    expect(usePipelineRefreshDraft).toBeDefined()
  })

  it('should export usePipelineRun', () => {
    expect(usePipelineRun).toBeDefined()
  })

  it('should export usePipelineStartRun', () => {
    expect(usePipelineStartRun).toBeDefined()
  })
})

afterEach(() => {
  vi.clearAllMocks()
})
