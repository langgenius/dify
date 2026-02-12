import type { Datasource } from '../../types'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { DatasourceType } from '@/models/pipeline'
import FooterTips from '../footer-tips'
import {
  useDatasourceOptions,
  useOnlineDocument,
  useOnlineDrive,
  useTestRunSteps,
  useWebsiteCrawl,
} from '../hooks'
import Preparation from '../index'
import StepIndicator from '../step-indicator'

let mockNodes: Array<{ id: string, data: DataSourceNodeType }> = []

const createNodeData = (overrides?: Partial<DataSourceNodeType>): DataSourceNodeType => ({
  title: 'Test Node',
  desc: 'Test description',
  type: 'data-source',
  provider_type: DatasourceType.localFile,
  provider_name: 'Local File',
  datasource_name: 'local_file',
  datasource_label: 'Local File',
  plugin_id: 'test-plugin',
  datasource_parameters: {},
  datasource_configurations: {},
  ...overrides,
} as unknown as DataSourceNodeType)

vi.mock('reactflow', () => ({
  useNodes: () => mockNodes,
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(fn: (state: unknown) => T) => fn,
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

let mockDataSourceStoreState = {
  localFileList: [] as Array<{ file: { id: string, name: string, type: string, size: number, extension: string, mime_type: string } }>,
  onlineDocuments: [] as Array<{ workspace_id: string, page_id?: string, title?: string }>,
  websitePages: [] as Array<{ url?: string, title?: string }>,
  selectedFileIds: [] as string[],
  currentCredentialId: '',
  currentNodeIdRef: { current: '' },
  bucket: '',
  onlineDriveFileList: [] as Array<{ id: string, name: string, type: string }>,
  setCurrentCredentialId: vi.fn(),
  setDocumentsData: vi.fn(),
  setSearchValue: vi.fn(),
  setSelectedPagesId: vi.fn(),
  setOnlineDocuments: vi.fn(),
  setCurrentDocument: vi.fn(),
  setStep: vi.fn(),
  setCrawlResult: vi.fn(),
  setWebsitePages: vi.fn(),
  setPreviewIndex: vi.fn(),
  setCurrentWebsite: vi.fn(),
  setOnlineDriveFileList: vi.fn(),
  setBucket: vi.fn(),
  setPrefix: vi.fn(),
  setKeywords: vi.fn(),
  setSelectedFileIds: vi.fn(),
}

vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/store', () => ({
  useDataSourceStore: () => ({
    getState: () => mockDataSourceStoreState,
  }),
  useDataSourceStoreWithSelector: <T,>(selector: (state: typeof mockDataSourceStoreState) => T) => selector(mockDataSourceStoreState),
}))

let mockWorkflowStoreState = {
  setIsPreparingDataSource: vi.fn(),
  pipelineId: 'test-pipeline-id',
}

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => mockWorkflowStoreState,
  }),
  useStore: <T,>(selector: (state: typeof mockWorkflowStoreState) => T) => selector(mockWorkflowStoreState),
}))

const mockHandleRun = vi.fn()

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowRun: () => ({
    handleRun: mockHandleRun,
  }),
  useToolIcon: () => ({ type: 'icon', icon: 'test-icon' }),
}))

vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/local-file', () => ({
  default: ({ allowedExtensions, supportBatchUpload }: { allowedExtensions: string[], supportBatchUpload: boolean }) => (
    <div data-testid="local-file" data-extensions={JSON.stringify(allowedExtensions)} data-batch={supportBatchUpload}>
      LocalFile Component
    </div>
  ),
}))

type MockDataSourceComponentProps = {
  nodeId: string
  nodeData?: DataSourceNodeType
  isInPipeline?: boolean
  supportBatchUpload?: boolean
  onCredentialChange?: (credentialId: string) => void
}

vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/online-documents', () => ({
  default: ({ nodeId, isInPipeline, supportBatchUpload, onCredentialChange }: MockDataSourceComponentProps) => (
    <div data-testid="online-documents" data-node-id={nodeId} data-in-pipeline={isInPipeline} data-batch={supportBatchUpload}>
      <button onClick={() => onCredentialChange?.('new-credential-id')}>Change Credential</button>
      OnlineDocuments Component
    </div>
  ),
}))

vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/website-crawl', () => ({
  default: ({ nodeId, isInPipeline, supportBatchUpload, onCredentialChange }: MockDataSourceComponentProps) => (
    <div data-testid="website-crawl" data-node-id={nodeId} data-in-pipeline={isInPipeline} data-batch={supportBatchUpload}>
      <button onClick={() => onCredentialChange?.('new-credential-id')}>Change Credential</button>
      WebsiteCrawl Component
    </div>
  ),
}))

vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/online-drive', () => ({
  default: ({ nodeId, isInPipeline, supportBatchUpload, onCredentialChange }: MockDataSourceComponentProps) => (
    <div data-testid="online-drive" data-node-id={nodeId} data-in-pipeline={isInPipeline} data-batch={supportBatchUpload}>
      <button onClick={() => onCredentialChange?.('new-credential-id')}>Change Credential</button>
      OnlineDrive Component
    </div>
  ),
}))

vi.mock('../data-source-options', () => ({
  default: ({ dataSourceNodeId, onSelect }: { dataSourceNodeId: string, onSelect: (ds: Datasource) => void }) => (
    <div data-testid="data-source-options" data-selected={dataSourceNodeId}>
      <button
        data-testid="select-local-file"
        onClick={() => onSelect({
          nodeId: 'local-file-node',
          nodeData: createNodeData({ provider_type: DatasourceType.localFile, fileExtensions: ['txt', 'pdf'] }),
        })}
      >
        Select Local File
      </button>
      <button
        data-testid="select-online-document"
        onClick={() => onSelect({
          nodeId: 'online-doc-node',
          nodeData: createNodeData({ provider_type: DatasourceType.onlineDocument }),
        })}
      >
        Select Online Document
      </button>
      <button
        data-testid="select-website-crawl"
        onClick={() => onSelect({
          nodeId: 'website-crawl-node',
          nodeData: createNodeData({ provider_type: DatasourceType.websiteCrawl }),
        })}
      >
        Select Website Crawl
      </button>
      <button
        data-testid="select-online-drive"
        onClick={() => onSelect({
          nodeId: 'online-drive-node',
          nodeData: createNodeData({ provider_type: DatasourceType.onlineDrive }),
        })}
      >
        Select Online Drive
      </button>
      <button
        data-testid="select-unknown-type"
        onClick={() => onSelect({
          nodeId: 'unknown-type-node',
          nodeData: createNodeData({ provider_type: 'unknown_type' as DatasourceType }),
        })}
      >
        Select Unknown Type
      </button>
      DataSourceOptions
    </div>
  ),
}))

vi.mock('../document-processing', () => ({
  default: ({ dataSourceNodeId, onProcess, onBack }: { dataSourceNodeId: string, onProcess: (data: Record<string, unknown>) => void, onBack: () => void }) => (
    <div data-testid="document-processing" data-node-id={dataSourceNodeId}>
      <button data-testid="process-btn" onClick={() => onProcess({ field1: 'value1' })}>Process</button>
      <button data-testid="back-btn" onClick={onBack}>Back</button>
      DocumentProcessing
    </div>
  ),
}))

const resetAllMocks = () => {
  mockDataSourceStoreState = {
    localFileList: [],
    onlineDocuments: [],
    websitePages: [],
    selectedFileIds: [],
    currentCredentialId: '',
    currentNodeIdRef: { current: '' },
    bucket: '',
    onlineDriveFileList: [],
    setCurrentCredentialId: vi.fn(),
    setDocumentsData: vi.fn(),
    setSearchValue: vi.fn(),
    setSelectedPagesId: vi.fn(),
    setOnlineDocuments: vi.fn(),
    setCurrentDocument: vi.fn(),
    setStep: vi.fn(),
    setCrawlResult: vi.fn(),
    setWebsitePages: vi.fn(),
    setPreviewIndex: vi.fn(),
    setCurrentWebsite: vi.fn(),
    setOnlineDriveFileList: vi.fn(),
    setBucket: vi.fn(),
    setPrefix: vi.fn(),
    setKeywords: vi.fn(),
    setSelectedFileIds: vi.fn(),
  }
  mockWorkflowStoreState = {
    setIsPreparingDataSource: vi.fn(),
    pipelineId: 'test-pipeline-id',
  }
  mockNodes = []
  mockHandleRun.mockClear()
}

describe('StepIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultSteps = [
    { label: 'Step 1', value: 'step1' },
    { label: 'Step 2', value: 'step2' },
    { label: 'Step 3', value: 'step3' },
  ]

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<StepIndicator steps={defaultSteps} currentStep={1} />)

      expect(screen.getByText('Step 1')).toBeInTheDocument()
      expect(screen.getByText('Step 2')).toBeInTheDocument()
      expect(screen.getByText('Step 3')).toBeInTheDocument()
    })

    it('should render all step labels', () => {
      const steps = [
        { label: 'Data Source', value: 'dataSource' },
        { label: 'Processing', value: 'processing' },
      ]

      render(<StepIndicator steps={steps} currentStep={1} />)

      expect(screen.getByText('Data Source')).toBeInTheDocument()
      expect(screen.getByText('Processing')).toBeInTheDocument()
    })

    it('should render container with correct classes', () => {
      const { container } = render(<StepIndicator steps={defaultSteps} currentStep={1} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('flex')
      expect(wrapper.className).toContain('items-center')
      expect(wrapper.className).toContain('gap-x-2')
      expect(wrapper.className).toContain('px-4')
      expect(wrapper.className).toContain('pb-2')
    })

    it('should render divider between steps but not after last step', () => {
      const { container } = render(<StepIndicator steps={defaultSteps} currentStep={1} />)

      const dividers = container.querySelectorAll('.h-px.w-3')
      expect(dividers.length).toBe(2)
    })

    it('should not render divider when there is only one step', () => {
      const singleStep = [{ label: 'Only Step', value: 'only' }]

      const { container } = render(<StepIndicator steps={singleStep} currentStep={1} />)

      const dividers = container.querySelectorAll('.h-px.w-3')
      expect(dividers.length).toBe(0)
    })
  })

  describe('Props Variations', () => {
    it('should highlight first step when currentStep is 1', () => {
      const { container } = render(<StepIndicator steps={defaultSteps} currentStep={1} />)

      const indicators = container.querySelectorAll('.bg-state-accent-solid')
      expect(indicators.length).toBe(1) // The dot indicator
    })

    it('should highlight second step when currentStep is 2', () => {
      render(<StepIndicator steps={defaultSteps} currentStep={2} />)

      const step2Container = screen.getByText('Step 2').parentElement
      expect(step2Container?.className).toContain('text-state-accent-solid')
    })

    it('should highlight third step when currentStep is 3', () => {
      render(<StepIndicator steps={defaultSteps} currentStep={3} />)

      const step3Container = screen.getByText('Step 3').parentElement
      expect(step3Container?.className).toContain('text-state-accent-solid')
    })

    it('should apply tertiary color to non-current steps', () => {
      render(<StepIndicator steps={defaultSteps} currentStep={1} />)

      const step2Container = screen.getByText('Step 2').parentElement
      expect(step2Container?.className).toContain('text-text-tertiary')
    })

    it('should show dot indicator only for current step', () => {
      const { container } = render(<StepIndicator steps={defaultSteps} currentStep={2} />)

      const dots = container.querySelectorAll('.size-1.rounded-full')
      expect(dots.length).toBe(1)
    })

    it('should handle empty steps array', () => {
      const { container } = render(<StepIndicator steps={[]} currentStep={1} />)

      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      const { rerender } = render(<StepIndicator steps={defaultSteps} currentStep={1} />)

      rerender(<StepIndicator steps={defaultSteps} currentStep={1} />)

      expect(screen.getByText('Step 1')).toBeInTheDocument()
    })

    it('should update when currentStep changes', () => {
      const { rerender } = render(<StepIndicator steps={defaultSteps} currentStep={1} />)

      let step1Container = screen.getByText('Step 1').parentElement
      expect(step1Container?.className).toContain('text-state-accent-solid')

      rerender(<StepIndicator steps={defaultSteps} currentStep={2} />)

      step1Container = screen.getByText('Step 1').parentElement
      expect(step1Container?.className).toContain('text-text-tertiary')
      const step2Container = screen.getByText('Step 2').parentElement
      expect(step2Container?.className).toContain('text-state-accent-solid')
    })

    it('should update when steps array changes', () => {
      const { rerender } = render(<StepIndicator steps={defaultSteps} currentStep={1} />)

      const newSteps = [
        { label: 'New Step 1', value: 'new1' },
        { label: 'New Step 2', value: 'new2' },
      ]
      rerender(<StepIndicator steps={newSteps} currentStep={1} />)

      expect(screen.getByText('New Step 1')).toBeInTheDocument()
      expect(screen.getByText('New Step 2')).toBeInTheDocument()
      expect(screen.queryByText('Step 3')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle currentStep of 0', () => {
      const { container } = render(<StepIndicator steps={defaultSteps} currentStep={0} />)

      const dots = container.querySelectorAll('.size-1.rounded-full')
      expect(dots.length).toBe(0)
    })

    it('should handle currentStep greater than steps length', () => {
      const { container } = render(<StepIndicator steps={defaultSteps} currentStep={10} />)

      const dots = container.querySelectorAll('.size-1.rounded-full')
      expect(dots.length).toBe(0)
    })

    it('should handle steps with empty labels', () => {
      const stepsWithEmpty = [
        { label: '', value: 'empty' },
        { label: 'Valid', value: 'valid' },
      ]

      render(<StepIndicator steps={stepsWithEmpty} currentStep={1} />)

      expect(screen.getByText('Valid')).toBeInTheDocument()
    })

    it('should handle steps with very long labels', () => {
      const longLabel = 'A'.repeat(100)
      const stepsWithLong = [{ label: longLabel, value: 'long' }]

      render(<StepIndicator steps={stepsWithLong} currentStep={1} />)

      expect(screen.getByText(longLabel)).toBeInTheDocument()
    })

    it('should handle special characters in labels', () => {
      const specialSteps = [{ label: '<Test> & "Label"', value: 'special' }]

      render(<StepIndicator steps={specialSteps} currentStep={1} />)

      expect(screen.getByText('<Test> & "Label"')).toBeInTheDocument()
    })

    it('should handle unicode characters in labels', () => {
      const unicodeSteps = [{ label: '数据源 🎉', value: 'unicode' }]

      render(<StepIndicator steps={unicodeSteps} currentStep={1} />)

      expect(screen.getByText('数据源 🎉')).toBeInTheDocument()
    })

    it('should handle negative currentStep', () => {
      const { container } = render(<StepIndicator steps={defaultSteps} currentStep={-1} />)

      const dots = container.querySelectorAll('.size-1.rounded-full')
      expect(dots.length).toBe(0)
    })
  })
})

describe('FooterTips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<FooterTips />)

      expect(screen.getByText('datasetPipeline.testRun.tooltip')).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      const { container } = render(<FooterTips />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('system-xs-regular')
      expect(wrapper.className).toContain('flex')
      expect(wrapper.className).toContain('grow')
      expect(wrapper.className).toContain('flex-col')
      expect(wrapper.className).toContain('justify-end')
      expect(wrapper.className).toContain('p-4')
      expect(wrapper.className).toContain('pt-2')
      expect(wrapper.className).toContain('text-text-tertiary')
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      const { rerender } = render(<FooterTips />)

      rerender(<FooterTips />)

      expect(screen.getByText('datasetPipeline.testRun.tooltip')).toBeInTheDocument()
    })

    it('should render consistently across multiple rerenders', () => {
      const { rerender } = render(<FooterTips />)

      for (let i = 0; i < 5; i++)
        rerender(<FooterTips />)

      expect(screen.getByText('datasetPipeline.testRun.tooltip')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle unmount cleanly', () => {
      const { unmount } = render(<FooterTips />)

      expect(() => unmount()).not.toThrow()
    })
  })
})

describe('useTestRunSteps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('should initialize with currentStep as 1', () => {
      const { result } = renderHook(() => useTestRunSteps())

      expect(result.current.currentStep).toBe(1)
    })

    it('should provide steps array with data source and document processing steps', () => {
      const { result } = renderHook(() => useTestRunSteps())

      expect(result.current.steps).toHaveLength(2)
      expect(result.current.steps[0].value).toBe('dataSource')
      expect(result.current.steps[1].value).toBe('documentProcessing')
    })

    it('should provide translated step labels', () => {
      const { result } = renderHook(() => useTestRunSteps())

      expect(result.current.steps[0].label).toContain('testRun.steps.dataSource')
      expect(result.current.steps[1].label).toContain('testRun.steps.documentProcessing')
    })
  })

  describe('handleNextStep', () => {
    it('should increment currentStep by 1', () => {
      const { result } = renderHook(() => useTestRunSteps())

      act(() => {
        result.current.handleNextStep()
      })

      expect(result.current.currentStep).toBe(2)
    })

    it('should continue incrementing on multiple calls', () => {
      const { result } = renderHook(() => useTestRunSteps())

      act(() => {
        result.current.handleNextStep()
        result.current.handleNextStep()
        result.current.handleNextStep()
      })

      expect(result.current.currentStep).toBe(4)
    })
  })

  describe('handleBackStep', () => {
    it('should decrement currentStep by 1', () => {
      const { result } = renderHook(() => useTestRunSteps())

      act(() => {
        result.current.handleNextStep()
      })
      expect(result.current.currentStep).toBe(2)

      act(() => {
        result.current.handleBackStep()
      })

      expect(result.current.currentStep).toBe(1)
    })

    it('should allow going to negative steps (no validation)', () => {
      const { result } = renderHook(() => useTestRunSteps())

      act(() => {
        result.current.handleBackStep()
      })

      expect(result.current.currentStep).toBe(0)
    })

    it('should continue decrementing on multiple calls', () => {
      const { result } = renderHook(() => useTestRunSteps())

      act(() => {
        for (let i = 0; i < 4; i++)
          result.current.handleNextStep()
      })
      expect(result.current.currentStep).toBe(5)

      act(() => {
        result.current.handleBackStep()
        result.current.handleBackStep()
        result.current.handleBackStep()
      })

      expect(result.current.currentStep).toBe(2)
    })
  })

  describe('Callback Stability', () => {
    it('should return stable handleNextStep callback', () => {
      const { result, rerender } = renderHook(() => useTestRunSteps())
      const initialCallback = result.current.handleNextStep

      rerender()

      expect(result.current.handleNextStep).toBe(initialCallback)
    })

    it('should return stable handleBackStep callback', () => {
      const { result, rerender } = renderHook(() => useTestRunSteps())
      const initialCallback = result.current.handleBackStep

      rerender()

      expect(result.current.handleBackStep).toBe(initialCallback)
    })
  })

  describe('Integration', () => {
    it('should handle forward and backward navigation', () => {
      const { result } = renderHook(() => useTestRunSteps())

      act(() => result.current.handleNextStep())
      expect(result.current.currentStep).toBe(2)

      act(() => result.current.handleNextStep())
      expect(result.current.currentStep).toBe(3)

      act(() => result.current.handleBackStep())
      expect(result.current.currentStep).toBe(2)

      act(() => result.current.handleBackStep())
      expect(result.current.currentStep).toBe(1)
    })
  })
})

describe('useDatasourceOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAllMocks()
  })

  describe('Basic Functionality', () => {
    it('should return empty array when no nodes exist', () => {
      mockNodes = []

      const { result } = renderHook(() => useDatasourceOptions())

      expect(result.current).toEqual([])
    })

    it('should return empty array when no DataSource nodes exist', () => {
      mockNodes = [
        {
          id: 'node-1',
          data: {
            ...createNodeData(),
            type: 'llm', // Not a DataSource type
          } as DataSourceNodeType,
        },
      ]

      const { result } = renderHook(() => useDatasourceOptions())

      expect(result.current).toEqual([])
    })

    it('should return options for DataSource nodes only', () => {
      mockNodes = [
        {
          id: 'datasource-1',
          data: {
            ...createNodeData({ title: 'Local File Source' }),
            type: 'datasource',
          } as DataSourceNodeType,
        },
        {
          id: 'llm-node',
          data: {
            ...createNodeData({ title: 'LLM Node' }),
            type: 'llm',
          } as DataSourceNodeType,
        },
        {
          id: 'datasource-2',
          data: {
            ...createNodeData({ title: 'Online Doc Source' }),
            type: 'datasource',
          } as DataSourceNodeType,
        },
      ]

      const { result } = renderHook(() => useDatasourceOptions())

      expect(result.current).toHaveLength(2)
      expect(result.current[0]).toEqual({
        label: 'Local File Source',
        value: 'datasource-1',
        data: expect.objectContaining({ title: 'Local File Source' }),
      })
      expect(result.current[1]).toEqual({
        label: 'Online Doc Source',
        value: 'datasource-2',
        data: expect.objectContaining({ title: 'Online Doc Source' }),
      })
    })

    it('should map node id to option value', () => {
      mockNodes = [
        {
          id: 'unique-node-id-123',
          data: {
            ...createNodeData({ title: 'Test Source' }),
            type: 'datasource',
          } as DataSourceNodeType,
        },
      ]

      const { result } = renderHook(() => useDatasourceOptions())

      expect(result.current[0].value).toBe('unique-node-id-123')
    })

    it('should map node title to option label', () => {
      mockNodes = [
        {
          id: 'node-1',
          data: {
            ...createNodeData({ title: 'Custom Data Source Title' }),
            type: 'datasource',
          } as DataSourceNodeType,
        },
      ]

      const { result } = renderHook(() => useDatasourceOptions())

      expect(result.current[0].label).toBe('Custom Data Source Title')
    })

    it('should include full node data in option', () => {
      const nodeData = {
        ...createNodeData({
          title: 'Full Data Test',
          provider_type: DatasourceType.websiteCrawl,
          provider_name: 'Website Crawler',
        }),
        type: 'datasource',
      } as DataSourceNodeType

      mockNodes = [
        {
          id: 'node-1',
          data: nodeData,
        },
      ]

      const { result } = renderHook(() => useDatasourceOptions())

      expect(result.current[0].data).toEqual(nodeData)
    })
  })

  describe('Memoization', () => {
    it('should return same options reference when nodes do not change', () => {
      mockNodes = [
        {
          id: 'node-1',
          data: {
            ...createNodeData({ title: 'Test' }),
            type: 'datasource',
          } as DataSourceNodeType,
        },
      ]

      const { result, rerender } = renderHook(() => useDatasourceOptions())

      rerender()

      expect(result.current).toHaveLength(1)
      expect(result.current[0].label).toBe('Test')
    })

    it('should update options when nodes change', () => {
      mockNodes = [
        {
          id: 'node-1',
          data: {
            ...createNodeData({ title: 'First' }),
            type: 'datasource',
          } as DataSourceNodeType,
        },
      ]

      const { result, rerender } = renderHook(() => useDatasourceOptions())
      expect(result.current).toHaveLength(1)
      expect(result.current[0].label).toBe('First')

      mockNodes = [
        {
          id: 'node-2',
          data: {
            ...createNodeData({ title: 'Second' }),
            type: 'datasource',
          } as DataSourceNodeType,
        },
        {
          id: 'node-3',
          data: {
            ...createNodeData({ title: 'Third' }),
            type: 'datasource',
          } as DataSourceNodeType,
        },
      ]
      rerender()

      expect(result.current).toHaveLength(2)
      expect(result.current[0].label).toBe('Second')
      expect(result.current[1].label).toBe('Third')
    })
  })

  describe('Edge Cases', () => {
    it('should handle nodes with empty title', () => {
      mockNodes = [
        {
          id: 'node-1',
          data: {
            ...createNodeData({ title: '' }),
            type: 'datasource',
          } as DataSourceNodeType,
        },
      ]

      const { result } = renderHook(() => useDatasourceOptions())

      expect(result.current[0].label).toBe('')
    })

    it('should handle multiple DataSource nodes', () => {
      mockNodes = Array.from({ length: 10 }, (_, i) => ({
        id: `node-${i}`,
        data: {
          ...createNodeData({ title: `Source ${i}` }),
          type: 'datasource',
        } as DataSourceNodeType,
      }))

      const { result } = renderHook(() => useDatasourceOptions())

      expect(result.current).toHaveLength(10)
      result.current.forEach((option, i) => {
        expect(option.value).toBe(`node-${i}`)
        expect(option.label).toBe(`Source ${i}`)
      })
    })
  })
})

describe('useOnlineDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAllMocks()
  })

  describe('clearOnlineDocumentData', () => {
    it('should clear all online document related data', () => {
      const { result } = renderHook(() => useOnlineDocument())

      act(() => {
        result.current.clearOnlineDocumentData()
      })

      expect(mockDataSourceStoreState.setDocumentsData).toHaveBeenCalledWith([])
      expect(mockDataSourceStoreState.setSearchValue).toHaveBeenCalledWith('')
      expect(mockDataSourceStoreState.setSelectedPagesId).toHaveBeenCalledWith(new Set())
      expect(mockDataSourceStoreState.setOnlineDocuments).toHaveBeenCalledWith([])
      expect(mockDataSourceStoreState.setCurrentDocument).toHaveBeenCalledWith(undefined)
    })

    it('should call all clear functions in correct order', () => {
      const { result } = renderHook(() => useOnlineDocument())
      const callOrder: string[] = []
      mockDataSourceStoreState.setDocumentsData = vi.fn(() => callOrder.push('setDocumentsData'))
      mockDataSourceStoreState.setSearchValue = vi.fn(() => callOrder.push('setSearchValue'))
      mockDataSourceStoreState.setSelectedPagesId = vi.fn(() => callOrder.push('setSelectedPagesId'))
      mockDataSourceStoreState.setOnlineDocuments = vi.fn(() => callOrder.push('setOnlineDocuments'))
      mockDataSourceStoreState.setCurrentDocument = vi.fn(() => callOrder.push('setCurrentDocument'))

      act(() => {
        result.current.clearOnlineDocumentData()
      })

      expect(callOrder).toEqual([
        'setDocumentsData',
        'setSearchValue',
        'setSelectedPagesId',
        'setOnlineDocuments',
        'setCurrentDocument',
      ])
    })
  })

  describe('Callback Stability', () => {
    it('should maintain functional callback after rerender', () => {
      const { result, rerender } = renderHook(() => useOnlineDocument())

      act(() => {
        result.current.clearOnlineDocumentData()
      })
      const firstCallCount = mockDataSourceStoreState.setDocumentsData.mock.calls.length

      rerender()

      act(() => {
        result.current.clearOnlineDocumentData()
      })

      expect(mockDataSourceStoreState.setDocumentsData.mock.calls.length).toBe(firstCallCount + 1)
    })
  })
})

describe('useWebsiteCrawl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAllMocks()
  })

  describe('clearWebsiteCrawlData', () => {
    it('should clear all website crawl related data', () => {
      const { result } = renderHook(() => useWebsiteCrawl())

      act(() => {
        result.current.clearWebsiteCrawlData()
      })

      expect(mockDataSourceStoreState.setStep).toHaveBeenCalledWith('init')
      expect(mockDataSourceStoreState.setCrawlResult).toHaveBeenCalledWith(undefined)
      expect(mockDataSourceStoreState.setCurrentWebsite).toHaveBeenCalledWith(undefined)
      expect(mockDataSourceStoreState.setWebsitePages).toHaveBeenCalledWith([])
      expect(mockDataSourceStoreState.setPreviewIndex).toHaveBeenCalledWith(-1)
    })

    it('should call all clear functions in correct order', () => {
      const { result } = renderHook(() => useWebsiteCrawl())
      const callOrder: string[] = []
      mockDataSourceStoreState.setStep = vi.fn(() => callOrder.push('setStep'))
      mockDataSourceStoreState.setCrawlResult = vi.fn(() => callOrder.push('setCrawlResult'))
      mockDataSourceStoreState.setCurrentWebsite = vi.fn(() => callOrder.push('setCurrentWebsite'))
      mockDataSourceStoreState.setWebsitePages = vi.fn(() => callOrder.push('setWebsitePages'))
      mockDataSourceStoreState.setPreviewIndex = vi.fn(() => callOrder.push('setPreviewIndex'))

      act(() => {
        result.current.clearWebsiteCrawlData()
      })

      expect(callOrder).toEqual([
        'setStep',
        'setCrawlResult',
        'setCurrentWebsite',
        'setWebsitePages',
        'setPreviewIndex',
      ])
    })
  })

  describe('Callback Stability', () => {
    it('should maintain functional callback after rerender', () => {
      const { result, rerender } = renderHook(() => useWebsiteCrawl())

      act(() => {
        result.current.clearWebsiteCrawlData()
      })
      const firstCallCount = mockDataSourceStoreState.setStep.mock.calls.length

      rerender()

      act(() => {
        result.current.clearWebsiteCrawlData()
      })

      expect(mockDataSourceStoreState.setStep.mock.calls.length).toBe(firstCallCount + 1)
    })
  })
})

describe('useOnlineDrive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAllMocks()
  })

  describe('clearOnlineDriveData', () => {
    it('should clear all online drive related data', () => {
      const { result } = renderHook(() => useOnlineDrive())

      act(() => {
        result.current.clearOnlineDriveData()
      })

      expect(mockDataSourceStoreState.setOnlineDriveFileList).toHaveBeenCalledWith([])
      expect(mockDataSourceStoreState.setBucket).toHaveBeenCalledWith('')
      expect(mockDataSourceStoreState.setPrefix).toHaveBeenCalledWith([])
      expect(mockDataSourceStoreState.setKeywords).toHaveBeenCalledWith('')
      expect(mockDataSourceStoreState.setSelectedFileIds).toHaveBeenCalledWith([])
    })

    it('should call all clear functions in correct order', () => {
      const { result } = renderHook(() => useOnlineDrive())
      const callOrder: string[] = []
      mockDataSourceStoreState.setOnlineDriveFileList = vi.fn(() => callOrder.push('setOnlineDriveFileList'))
      mockDataSourceStoreState.setBucket = vi.fn(() => callOrder.push('setBucket'))
      mockDataSourceStoreState.setPrefix = vi.fn(() => callOrder.push('setPrefix'))
      mockDataSourceStoreState.setKeywords = vi.fn(() => callOrder.push('setKeywords'))
      mockDataSourceStoreState.setSelectedFileIds = vi.fn(() => callOrder.push('setSelectedFileIds'))

      act(() => {
        result.current.clearOnlineDriveData()
      })

      expect(callOrder).toEqual([
        'setOnlineDriveFileList',
        'setBucket',
        'setPrefix',
        'setKeywords',
        'setSelectedFileIds',
      ])
    })
  })

  describe('Callback Stability', () => {
    it('should maintain functional callback after rerender', () => {
      const { result, rerender } = renderHook(() => useOnlineDrive())

      act(() => {
        result.current.clearOnlineDriveData()
      })
      const firstCallCount = mockDataSourceStoreState.setOnlineDriveFileList.mock.calls.length

      rerender()

      act(() => {
        result.current.clearOnlineDriveData()
      })

      expect(mockDataSourceStoreState.setOnlineDriveFileList.mock.calls.length).toBe(firstCallCount + 1)
    })
  })
})

describe('Preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Preparation />)

      expect(screen.getByTestId('data-source-options')).toBeInTheDocument()
    })

    it('should render StepIndicator', () => {
      render(<Preparation />)

      expect(screen.getByText('datasetPipeline.testRun.steps.dataSource')).toBeInTheDocument()
      expect(screen.getByText('datasetPipeline.testRun.steps.documentProcessing')).toBeInTheDocument()
    })

    it('should render DataSourceOptions on step 1', () => {
      render(<Preparation />)

      expect(screen.getByTestId('data-source-options')).toBeInTheDocument()
    })

    it('should render Actions on step 1', () => {
      render(<Preparation />)

      expect(screen.getByText('datasetCreation.stepOne.button')).toBeInTheDocument()
    })

    it('should render FooterTips on step 1', () => {
      render(<Preparation />)

      expect(screen.getByText('datasetPipeline.testRun.tooltip')).toBeInTheDocument()
    })

    it('should not render DocumentProcessing on step 1', () => {
      render(<Preparation />)

      expect(screen.queryByTestId('document-processing')).not.toBeInTheDocument()
    })
  })

  describe('Data Source Selection', () => {
    it('should render LocalFile component when local file datasource is selected', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(screen.getByTestId('local-file')).toBeInTheDocument()
    })

    it('should render OnlineDocuments component when online document datasource is selected', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-document'))

      expect(screen.getByTestId('online-documents')).toBeInTheDocument()
    })

    it('should render WebsiteCrawl component when website crawl datasource is selected', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-website-crawl'))

      expect(screen.getByTestId('website-crawl')).toBeInTheDocument()
    })

    it('should render OnlineDrive component when online drive datasource is selected', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-drive'))

      expect(screen.getByTestId('online-drive')).toBeInTheDocument()
    })

    it('should pass correct props to LocalFile component', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))

      const localFile = screen.getByTestId('local-file')
      expect(localFile).toHaveAttribute('data-extensions', '["txt","pdf"]')
      expect(localFile).toHaveAttribute('data-batch', 'false')
    })

    it('should pass isInPipeline=true to OnlineDocuments', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-document'))

      const onlineDocs = screen.getByTestId('online-documents')
      expect(onlineDocs).toHaveAttribute('data-in-pipeline', 'true')
    })

    it('should pass supportBatchUpload=false to all data source components', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-document'))

      expect(screen.getByTestId('online-documents')).toHaveAttribute('data-batch', 'false')
    })

    it('should update dataSourceNodeId when selecting different datasources', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(screen.getByTestId('data-source-options')).toHaveAttribute('data-selected', 'local-file-node')

      fireEvent.click(screen.getByTestId('select-online-document'))

      expect(screen.getByTestId('data-source-options')).toHaveAttribute('data-selected', 'online-doc-node')
    })
  })

  describe('Next Button Disabled State', () => {
    it('should disable next button when no datasource is selected', () => {
      render(<Preparation />)

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should disable next button for local file when file list is empty', () => {
      mockDataSourceStoreState.localFileList = []
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should disable next button for local file when file has no id', () => {
      mockDataSourceStoreState.localFileList = [
        { file: { id: '', name: 'test.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should enable next button for local file when file has valid id', () => {
      mockDataSourceStoreState.localFileList = [
        { file: { id: 'file-123', name: 'test.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).not.toBeDisabled()
    })

    it('should disable next button for online document when documents list is empty', () => {
      mockDataSourceStoreState.onlineDocuments = []
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-document'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should enable next button for online document when documents exist', () => {
      mockDataSourceStoreState.onlineDocuments = [{ workspace_id: 'ws-1', page_id: 'page-1' }]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-document'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).not.toBeDisabled()
    })

    it('should disable next button for website crawl when pages list is empty', () => {
      mockDataSourceStoreState.websitePages = []
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-website-crawl'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should enable next button for website crawl when pages exist', () => {
      mockDataSourceStoreState.websitePages = [{ url: 'https://example.com' }]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-website-crawl'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).not.toBeDisabled()
    })

    it('should disable next button for online drive when no files selected', () => {
      mockDataSourceStoreState.selectedFileIds = []
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-drive'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()
    })

    it('should enable next button for online drive when files are selected', () => {
      mockDataSourceStoreState.selectedFileIds = ['file-1']
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-drive'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).not.toBeDisabled()
    })
  })

  describe('Step Navigation', () => {
    it('should navigate to step 2 when next button is clicked with valid data', () => {
      mockDataSourceStoreState.localFileList = [
        { file: { id: 'file-123', name: 'test.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      expect(screen.getByTestId('document-processing')).toBeInTheDocument()
      expect(screen.queryByTestId('data-source-options')).not.toBeInTheDocument()
    })

    it('should pass correct dataSourceNodeId to DocumentProcessing', () => {
      mockDataSourceStoreState.localFileList = [
        { file: { id: 'file-123', name: 'test.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      expect(screen.getByTestId('document-processing')).toHaveAttribute('data-node-id', 'local-file-node')
    })

    it('should navigate back to step 1 when back button is clicked', () => {
      mockDataSourceStoreState.localFileList = [
        { file: { id: 'file-123', name: 'test.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))
      expect(screen.getByTestId('document-processing')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('back-btn'))

      expect(screen.getByTestId('data-source-options')).toBeInTheDocument()
      expect(screen.queryByTestId('document-processing')).not.toBeInTheDocument()
    })
  })

  describe('handleProcess', () => {
    it('should call handleRun with correct params for local file', async () => {
      mockDataSourceStoreState.localFileList = [
        { file: { id: 'file-123', name: 'test.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))
      fireEvent.click(screen.getByTestId('process-btn'))

      await waitFor(() => {
        expect(mockHandleRun).toHaveBeenCalledWith(expect.objectContaining({
          inputs: { field1: 'value1' },
          start_node_id: 'local-file-node',
          datasource_type: DatasourceType.localFile,
        }))
      })
    })

    it('should call handleRun with correct params for online document', async () => {
      mockDataSourceStoreState.onlineDocuments = [{ workspace_id: 'ws-1', page_id: 'page-1', title: 'Test Doc' }]
      mockDataSourceStoreState.currentCredentialId = 'cred-123'
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-document'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))
      fireEvent.click(screen.getByTestId('process-btn'))

      await waitFor(() => {
        expect(mockHandleRun).toHaveBeenCalledWith(expect.objectContaining({
          inputs: { field1: 'value1' },
          start_node_id: 'online-doc-node',
          datasource_type: DatasourceType.onlineDocument,
        }))
      })
    })

    it('should call handleRun with correct params for website crawl', async () => {
      mockDataSourceStoreState.websitePages = [{ url: 'https://example.com', title: 'Example' }]
      mockDataSourceStoreState.currentCredentialId = 'cred-456'
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-website-crawl'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))
      fireEvent.click(screen.getByTestId('process-btn'))

      await waitFor(() => {
        expect(mockHandleRun).toHaveBeenCalledWith(expect.objectContaining({
          inputs: { field1: 'value1' },
          start_node_id: 'website-crawl-node',
          datasource_type: DatasourceType.websiteCrawl,
        }))
      })
    })

    it('should call handleRun with correct params for online drive', async () => {
      mockDataSourceStoreState.selectedFileIds = ['file-1']
      mockDataSourceStoreState.onlineDriveFileList = [{ id: 'file-1', name: 'data.csv', type: 'file' }]
      mockDataSourceStoreState.bucket = 'my-bucket'
      mockDataSourceStoreState.currentCredentialId = 'cred-789'
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-drive'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))
      fireEvent.click(screen.getByTestId('process-btn'))

      await waitFor(() => {
        expect(mockHandleRun).toHaveBeenCalledWith(expect.objectContaining({
          inputs: { field1: 'value1' },
          start_node_id: 'online-drive-node',
          datasource_type: DatasourceType.onlineDrive,
        }))
      })
    })

    it('should call setIsPreparingDataSource(false) after processing', async () => {
      mockDataSourceStoreState.localFileList = [
        { file: { id: 'file-123', name: 'test.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))
      fireEvent.click(screen.getByTestId('process-btn'))

      await waitFor(() => {
        expect(mockWorkflowStoreState.setIsPreparingDataSource).toHaveBeenCalledWith(false)
      })
    })
  })

  describe('clearDataSourceData', () => {
    it('should clear online document data when switching from online document', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-document'))
      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(mockDataSourceStoreState.setDocumentsData).toHaveBeenCalled()
      expect(mockDataSourceStoreState.setOnlineDocuments).toHaveBeenCalled()
    })

    it('should clear website crawl data when switching from website crawl', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-website-crawl'))
      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(mockDataSourceStoreState.setWebsitePages).toHaveBeenCalled()
      expect(mockDataSourceStoreState.setCrawlResult).toHaveBeenCalled()
    })

    it('should clear online drive data when switching from online drive', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-drive'))
      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(mockDataSourceStoreState.setOnlineDriveFileList).toHaveBeenCalled()
      expect(mockDataSourceStoreState.setBucket).toHaveBeenCalled()
    })
  })

  describe('handleCredentialChange', () => {
    it('should update credential and clear data when credential changes for online document', () => {
      mockDataSourceStoreState.onlineDocuments = [{ workspace_id: 'ws-1' }]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-document'))
      fireEvent.click(screen.getByText('Change Credential'))

      expect(mockDataSourceStoreState.setCurrentCredentialId).toHaveBeenCalledWith('new-credential-id')
    })

    it('should clear data when credential changes for website crawl', () => {
      mockDataSourceStoreState.websitePages = [{ url: 'https://example.com' }]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-website-crawl'))
      fireEvent.click(screen.getByText('Change Credential'))

      expect(mockDataSourceStoreState.setCurrentCredentialId).toHaveBeenCalledWith('new-credential-id')
      expect(mockDataSourceStoreState.setWebsitePages).toHaveBeenCalled()
    })

    it('should clear data when credential changes for online drive', () => {
      mockDataSourceStoreState.selectedFileIds = ['file-1']
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-drive'))
      fireEvent.click(screen.getByText('Change Credential'))

      expect(mockDataSourceStoreState.setCurrentCredentialId).toHaveBeenCalledWith('new-credential-id')
      expect(mockDataSourceStoreState.setOnlineDriveFileList).toHaveBeenCalled()
    })
  })

  describe('handleSwitchDataSource', () => {
    it('should clear credential when switching datasource', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(mockDataSourceStoreState.setCurrentCredentialId).toHaveBeenCalledWith('')
    })

    it('should update currentNodeIdRef when switching datasource', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(mockDataSourceStoreState.currentNodeIdRef.current).toBe('local-file-node')
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      const { rerender } = render(<Preparation />)
      rerender(<Preparation />)

      expect(screen.getByTestId('data-source-options')).toBeInTheDocument()
    })

    it('should maintain state across rerenders', () => {
      mockDataSourceStoreState.localFileList = [
        { file: { id: 'file-123', name: 'test.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      const { rerender } = render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      rerender(<Preparation />)

      expect(screen.getByTestId('document-processing')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle unmount cleanly', () => {
      const { unmount } = render(<Preparation />)

      expect(() => unmount()).not.toThrow()
    })

    it('should enable next button for unknown datasource type (return false branch)', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-unknown-type'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).not.toBeDisabled()
    })

    it('should handle handleProcess with unknown datasource type', async () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-unknown-type'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      fireEvent.click(screen.getByTestId('process-btn'))

      await waitFor(() => {
        expect(mockHandleRun).toHaveBeenCalledWith(expect.objectContaining({
          start_node_id: 'unknown-type-node',
          datasource_type: 'unknown_type',
          datasource_info_list: [], // Empty because no type matched
        }))
      })
    })

    it('should handle rapid datasource switching', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))
      fireEvent.click(screen.getByTestId('select-online-document'))
      fireEvent.click(screen.getByTestId('select-website-crawl'))
      fireEvent.click(screen.getByTestId('select-online-drive'))
      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(screen.getByTestId('local-file')).toBeInTheDocument()
    })

    it('should handle rapid step navigation', () => {
      mockDataSourceStoreState.localFileList = [
        { file: { id: 'file-123', name: 'test.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))
      fireEvent.click(screen.getByTestId('back-btn'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))
      fireEvent.click(screen.getByTestId('back-btn'))

      expect(screen.getByTestId('data-source-options')).toBeInTheDocument()
    })
  })

  describe('Integration', () => {
    it('should complete full flow: select datasource -> next -> process', async () => {
      mockDataSourceStoreState.localFileList = [
        { file: { id: 'file-123', name: 'test.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))
      expect(screen.getByTestId('local-file')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))
      expect(screen.getByTestId('document-processing')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('process-btn'))

      await waitFor(() => {
        expect(mockHandleRun).toHaveBeenCalled()
      })
    })

    it('should complete full flow with back navigation', async () => {
      mockDataSourceStoreState.localFileList = [
        { file: { id: 'file-123', name: 'test.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      mockDataSourceStoreState.onlineDocuments = [{ workspace_id: 'ws-1' }]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))
      expect(screen.getByTestId('document-processing')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('back-btn'))
      fireEvent.click(screen.getByTestId('select-online-document'))
      expect(screen.getByTestId('online-documents')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      expect(screen.getByTestId('document-processing')).toHaveAttribute('data-node-id', 'online-doc-node')
    })
  })
})

describe('Callback Dependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAllMocks()
  })

  describe('nextBtnDisabled Memoization', () => {
    it('should update when localFileList changes', () => {
      const { rerender } = render(<Preparation />)
      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()

      mockDataSourceStoreState.localFileList = [
        { file: { id: 'file-123', name: 'test.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      rerender(<Preparation />)
      fireEvent.click(screen.getByTestId('select-local-file'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).not.toBeDisabled()
    })

    it('should update when onlineDocuments changes', () => {
      const { rerender } = render(<Preparation />)
      fireEvent.click(screen.getByTestId('select-online-document'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()

      mockDataSourceStoreState.onlineDocuments = [{ workspace_id: 'ws-1' }]
      rerender(<Preparation />)
      fireEvent.click(screen.getByTestId('select-online-document'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).not.toBeDisabled()
    })

    it('should update when websitePages changes', () => {
      const { rerender } = render(<Preparation />)
      fireEvent.click(screen.getByTestId('select-website-crawl'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()

      mockDataSourceStoreState.websitePages = [{ url: 'https://example.com' }]
      rerender(<Preparation />)
      fireEvent.click(screen.getByTestId('select-website-crawl'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).not.toBeDisabled()
    })

    it('should update when selectedFileIds changes', () => {
      const { rerender } = render(<Preparation />)
      fireEvent.click(screen.getByTestId('select-online-drive'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).toBeDisabled()

      mockDataSourceStoreState.selectedFileIds = ['file-1']
      rerender(<Preparation />)
      fireEvent.click(screen.getByTestId('select-online-drive'))

      expect(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i })).not.toBeDisabled()
    })
  })

  describe('handleProcess Callback Dependencies', () => {
    it('should use latest store state when processing', async () => {
      mockDataSourceStoreState.localFileList = [
        { file: { id: 'initial-file', name: 'initial.txt', type: 'text/plain', size: 100, extension: 'txt', mime_type: 'text/plain' } },
      ]
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-local-file'))
      fireEvent.click(screen.getByRole('button', { name: /datasetCreation.stepOne.button/i }))

      mockDataSourceStoreState.localFileList = [
        { file: { id: 'updated-file', name: 'updated.txt', type: 'text/plain', size: 200, extension: 'txt', mime_type: 'text/plain' } },
      ]

      fireEvent.click(screen.getByTestId('process-btn'))

      await waitFor(() => {
        expect(mockHandleRun).toHaveBeenCalledWith(expect.objectContaining({
          datasource_info_list: expect.arrayContaining([
            expect.objectContaining({ related_id: 'updated-file' }),
          ]),
        }))
      })
    })
  })

  describe('clearDataSourceData Callback Dependencies', () => {
    it('should call correct clear function based on datasource type', () => {
      render(<Preparation />)

      fireEvent.click(screen.getByTestId('select-online-document'))

      expect(mockDataSourceStoreState.setOnlineDocuments).toHaveBeenCalled()

      fireEvent.click(screen.getByTestId('select-website-crawl'))

      expect(mockDataSourceStoreState.setWebsitePages).toHaveBeenCalled()
    })
  })
})
