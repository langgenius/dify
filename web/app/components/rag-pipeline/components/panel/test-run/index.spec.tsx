import type { GeneralChunks } from '@/app/components/rag-pipeline/components/chunk-card-list/types'
import type { WorkflowRunningData } from '@/app/components/workflow/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { ChunkingMode } from '@/models/datasets'
import Header from './header'
// Import components after mocks
import TestRunPanel from './index'

// ============================================================================
// Mocks
// ============================================================================

// Mock workflow store
const mockIsPreparingDataSource = vi.fn(() => true)
const mockSetIsPreparingDataSource = vi.fn()
const mockWorkflowRunningData = vi.fn<() => WorkflowRunningData | undefined>(() => undefined)
const mockPipelineId = 'test-pipeline-id'

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      isPreparingDataSource: mockIsPreparingDataSource(),
      workflowRunningData: mockWorkflowRunningData(),
      pipelineId: mockPipelineId,
    }
    return selector(state)
  },
  useWorkflowStore: () => ({
    getState: () => ({
      isPreparingDataSource: mockIsPreparingDataSource(),
      setIsPreparingDataSource: mockSetIsPreparingDataSource,
    }),
  }),
}))

// Mock workflow interactions
const mockHandleCancelDebugAndPreviewPanel = vi.fn()
vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowInteractions: () => ({
    handleCancelDebugAndPreviewPanel: mockHandleCancelDebugAndPreviewPanel,
  }),
  useWorkflowRun: () => ({
    handleRun: vi.fn(),
  }),
  useToolIcon: () => 'mock-tool-icon',
}))

// Mock data source provider
vi.mock('@/app/components/datasets/documents/create-from-pipeline/data-source/store/provider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="data-source-provider">{children}</div>,
}))

// Mock Preparation component
vi.mock('./preparation', () => ({
  default: () => <div data-testid="preparation-component">Preparation</div>,
}))

// Mock Result component (for TestRunPanel tests only)
vi.mock('./result', () => ({
  default: () => <div data-testid="result-component">Result</div>,
}))

// Mock ResultPanel from workflow
vi.mock('@/app/components/workflow/run/result-panel', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="result-panel">
      ResultPanel -
      {' '}
      {props.status as string}
    </div>
  ),
}))

// Mock TracingPanel from workflow
vi.mock('@/app/components/workflow/run/tracing-panel', () => ({
  default: (props: { list: unknown[] }) => (
    <div data-testid="tracing-panel">
      TracingPanel -
      {' '}
      {props.list?.length ?? 0}
      {' '}
      items
    </div>
  ),
}))

// Mock Loading component
vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading">Loading...</div>,
}))

// Mock config
vi.mock('@/config', () => ({
  RAG_PIPELINE_PREVIEW_CHUNK_NUM: 5,
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createMockWorkflowRunningData = (overrides: Partial<WorkflowRunningData> = {}): WorkflowRunningData => ({
  result: {
    status: WorkflowRunningStatus.Succeeded,
    outputs: '{"test": "output"}',
    outputs_truncated: false,
    inputs: '{"test": "input"}',
    inputs_truncated: false,
    process_data_truncated: false,
    error: undefined,
    elapsed_time: 1000,
    total_tokens: 100,
    created_at: Date.now(),
    created_by: 'Test User',
    total_steps: 5,
    exceptions_count: 0,
  },
  tracing: [],
  ...overrides,
})

const createMockGeneralOutputs = (chunkContents: string[] = ['chunk1', 'chunk2']) => ({
  chunk_structure: ChunkingMode.text,
  preview: chunkContents.map(content => ({ content })),
})

const createMockParentChildOutputs = (parentMode: 'paragraph' | 'full-doc' = 'paragraph') => ({
  chunk_structure: ChunkingMode.parentChild,
  parent_mode: parentMode,
  preview: [
    { content: 'parent1', child_chunks: ['child1', 'child2'] },
    { content: 'parent2', child_chunks: ['child3', 'child4'] },
  ],
})

const createMockQAOutputs = () => ({
  chunk_structure: ChunkingMode.qa,
  qa_preview: [
    { question: 'Q1', answer: 'A1' },
    { question: 'Q2', answer: 'A2' },
  ],
})

// ============================================================================
// TestRunPanel Component Tests
// ============================================================================

describe('TestRunPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsPreparingDataSource.mockReturnValue(true)
    mockWorkflowRunningData.mockReturnValue(undefined)
  })

  // Basic rendering tests
  describe('Rendering', () => {
    it('should render with correct container styles', () => {
      const { container } = render(<TestRunPanel />)
      const panelDiv = container.firstChild as HTMLElement

      expect(panelDiv).toHaveClass('relative', 'flex', 'h-full', 'w-[480px]', 'flex-col')
    })

    it('should render Header component', () => {
      render(<TestRunPanel />)

      expect(screen.getByText('datasetPipeline.testRun.title')).toBeInTheDocument()
    })
  })

  // Conditional rendering based on isPreparingDataSource
  describe('Conditional Content Rendering', () => {
    it('should render Preparation inside DataSourceProvider when isPreparingDataSource is true', () => {
      mockIsPreparingDataSource.mockReturnValue(true)

      render(<TestRunPanel />)

      expect(screen.getByTestId('data-source-provider')).toBeInTheDocument()
      expect(screen.getByTestId('preparation-component')).toBeInTheDocument()
      expect(screen.queryByTestId('result-component')).not.toBeInTheDocument()
    })

    it('should render Result when isPreparingDataSource is false', () => {
      mockIsPreparingDataSource.mockReturnValue(false)

      render(<TestRunPanel />)

      expect(screen.getByTestId('result-component')).toBeInTheDocument()
      expect(screen.queryByTestId('data-source-provider')).not.toBeInTheDocument()
      expect(screen.queryByTestId('preparation-component')).not.toBeInTheDocument()
    })
  })
})

// ============================================================================
// Header Component Tests
// ============================================================================

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsPreparingDataSource.mockReturnValue(true)
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render title with correct translation key', () => {
      render(<Header />)

      expect(screen.getByText('datasetPipeline.testRun.title')).toBeInTheDocument()
    })

    it('should render close button', () => {
      render(<Header />)

      const closeButton = screen.getByRole('button')
      expect(closeButton).toBeInTheDocument()
    })

    it('should have correct layout classes', () => {
      const { container } = render(<Header />)
      const headerDiv = container.firstChild as HTMLElement

      expect(headerDiv).toHaveClass('flex', 'items-center', 'gap-x-2', 'pl-4', 'pr-3', 'pt-4')
    })
  })

  // Close button interactions
  describe('Close Button Interaction', () => {
    it('should call setIsPreparingDataSource(false) and handleCancelDebugAndPreviewPanel when clicked and isPreparingDataSource is true', () => {
      mockIsPreparingDataSource.mockReturnValue(true)

      render(<Header />)

      const closeButton = screen.getByRole('button')
      fireEvent.click(closeButton)

      expect(mockSetIsPreparingDataSource).toHaveBeenCalledWith(false)
      expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalledTimes(1)
    })

    it('should only call handleCancelDebugAndPreviewPanel when isPreparingDataSource is false', () => {
      mockIsPreparingDataSource.mockReturnValue(false)

      render(<Header />)

      const closeButton = screen.getByRole('button')
      fireEvent.click(closeButton)

      expect(mockSetIsPreparingDataSource).not.toHaveBeenCalled()
      expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalledTimes(1)
    })
  })
})

// ============================================================================
// Result Component Tests (Real Implementation)
// ============================================================================

// Unmock Result for these tests
vi.doUnmock('./result')

describe('Result', () => {
  // Dynamically import Result to get real implementation
  let Result: typeof import('./result').default

  beforeAll(async () => {
    const resultModule = await import('./result')
    Result = resultModule.default
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowRunningData.mockReturnValue(undefined)
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render with RESULT tab active by default', async () => {
      render(<Result />)

      await waitFor(() => {
        const resultTab = screen.getByRole('button', { name: /runLog\.result/i })
        expect(resultTab).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
      })
    })

    it('should render all three tabs', () => {
      render(<Result />)

      expect(screen.getByRole('button', { name: /runLog\.result/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /runLog\.detail/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /runLog\.tracing/i })).toBeInTheDocument()
    })
  })

  // Tab switching tests
  describe('Tab Switching', () => {
    it('should switch to DETAIL tab when clicked', async () => {
      mockWorkflowRunningData.mockReturnValue(createMockWorkflowRunningData())
      render(<Result />)

      const detailTab = screen.getByRole('button', { name: /runLog\.detail/i })
      fireEvent.click(detailTab)

      await waitFor(() => {
        expect(screen.getByTestId('result-panel')).toBeInTheDocument()
      })
    })

    it('should switch to TRACING tab when clicked', async () => {
      mockWorkflowRunningData.mockReturnValue(createMockWorkflowRunningData({ tracing: [{ id: '1' }] as unknown as WorkflowRunningData['tracing'] }))
      render(<Result />)

      const tracingTab = screen.getByRole('button', { name: /runLog\.tracing/i })
      fireEvent.click(tracingTab)

      await waitFor(() => {
        expect(screen.getByTestId('tracing-panel')).toBeInTheDocument()
      })
    })
  })

  // Loading states
  describe('Loading States', () => {
    it('should show loading in DETAIL tab when no result data', async () => {
      mockWorkflowRunningData.mockReturnValue({
        result: undefined as unknown as WorkflowRunningData['result'],
        tracing: [],
      })
      render(<Result />)

      const detailTab = screen.getByRole('button', { name: /runLog\.detail/i })
      fireEvent.click(detailTab)

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toBeInTheDocument()
      })
    })

    it('should show loading in TRACING tab when no tracing data', async () => {
      mockWorkflowRunningData.mockReturnValue(createMockWorkflowRunningData({ tracing: [] }))
      render(<Result />)

      const tracingTab = screen.getByRole('button', { name: /runLog\.tracing/i })
      fireEvent.click(tracingTab)

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toBeInTheDocument()
      })
    })
  })
})

// ============================================================================
// ResultPreview Component Tests
// ============================================================================

// We need to import ResultPreview directly
vi.doUnmock('./result/result-preview')

describe('ResultPreview', () => {
  let ResultPreview: typeof import('./result/result-preview').default

  beforeAll(async () => {
    const previewModule = await import('./result/result-preview')
    ResultPreview = previewModule.default
  })

  const mockOnSwitchToDetail = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Loading state
  describe('Loading State', () => {
    it('should show loading spinner when isRunning is true and no outputs', () => {
      render(
        <ResultPreview
          isRunning={true}
          outputs={undefined}
          error={undefined}
          onSwitchToDetail={mockOnSwitchToDetail}
        />,
      )

      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
    })

    it('should not show loading when outputs are available', () => {
      render(
        <ResultPreview
          isRunning={true}
          outputs={createMockGeneralOutputs()}
          error={undefined}
          onSwitchToDetail={mockOnSwitchToDetail}
        />,
      )

      expect(screen.queryByText('pipeline.result.resultPreview.loading')).not.toBeInTheDocument()
    })
  })

  // Error state
  describe('Error State', () => {
    it('should show error message when not running and has error', () => {
      render(
        <ResultPreview
          isRunning={false}
          outputs={undefined}
          error="Test error message"
          onSwitchToDetail={mockOnSwitchToDetail}
        />,
      )

      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'pipeline.result.resultPreview.viewDetails' })).toBeInTheDocument()
    })

    it('should call onSwitchToDetail when View Details button is clicked', () => {
      render(
        <ResultPreview
          isRunning={false}
          outputs={undefined}
          error="Test error message"
          onSwitchToDetail={mockOnSwitchToDetail}
        />,
      )

      const viewDetailsButton = screen.getByRole('button', { name: 'pipeline.result.resultPreview.viewDetails' })
      fireEvent.click(viewDetailsButton)

      expect(mockOnSwitchToDetail).toHaveBeenCalledTimes(1)
    })

    it('should not show error when still running', () => {
      render(
        <ResultPreview
          isRunning={true}
          outputs={undefined}
          error="Test error message"
          onSwitchToDetail={mockOnSwitchToDetail}
        />,
      )

      expect(screen.queryByText('pipeline.result.resultPreview.error')).not.toBeInTheDocument()
    })
  })

  // Success state with outputs
  describe('Success State with Outputs', () => {
    it('should render chunk content when outputs are available', () => {
      render(
        <ResultPreview
          isRunning={false}
          outputs={createMockGeneralOutputs(['test chunk content'])}
          error={undefined}
          onSwitchToDetail={mockOnSwitchToDetail}
        />,
      )

      // Check that chunk content is rendered (the real ChunkCardList renders the content)
      expect(screen.getByText('test chunk content')).toBeInTheDocument()
    })

    it('should render multiple chunks when provided', () => {
      render(
        <ResultPreview
          isRunning={false}
          outputs={createMockGeneralOutputs(['chunk one', 'chunk two'])}
          error={undefined}
          onSwitchToDetail={mockOnSwitchToDetail}
        />,
      )

      expect(screen.getByText('chunk one')).toBeInTheDocument()
      expect(screen.getByText('chunk two')).toBeInTheDocument()
    })

    it('should show footer tip', () => {
      render(
        <ResultPreview
          isRunning={false}
          outputs={createMockGeneralOutputs()}
          error={undefined}
          onSwitchToDetail={mockOnSwitchToDetail}
        />,
      )

      expect(screen.getByText(/pipeline\.result\.resultPreview\.footerTip/)).toBeInTheDocument()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle empty outputs gracefully', () => {
      render(
        <ResultPreview
          isRunning={false}
          outputs={null}
          error={undefined}
          onSwitchToDetail={mockOnSwitchToDetail}
        />,
      )

      // Should not crash and should not show chunk card list
      expect(screen.queryByTestId('chunk-card-list')).not.toBeInTheDocument()
    })

    it('should handle undefined outputs', () => {
      render(
        <ResultPreview
          isRunning={false}
          outputs={undefined}
          error={undefined}
          onSwitchToDetail={mockOnSwitchToDetail}
        />,
      )

      expect(screen.queryByTestId('chunk-card-list')).not.toBeInTheDocument()
    })
  })
})

// ============================================================================
// Tabs Component Tests
// ============================================================================

vi.doUnmock('./result/tabs')

describe('Tabs', () => {
  let Tabs: typeof import('./result/tabs').default

  beforeAll(async () => {
    const tabsModule = await import('./result/tabs')
    Tabs = tabsModule.default
  })

  const mockSwitchTab = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render all three tabs', () => {
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={createMockWorkflowRunningData()}
          switchTab={mockSwitchTab}
        />,
      )

      expect(screen.getByRole('button', { name: /runLog\.result/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /runLog\.detail/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /runLog\.tracing/i })).toBeInTheDocument()
    })
  })

  // Active tab styling
  describe('Active Tab Styling', () => {
    it('should highlight RESULT tab when currentTab is RESULT', () => {
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={createMockWorkflowRunningData()}
          switchTab={mockSwitchTab}
        />,
      )

      const resultTab = screen.getByRole('button', { name: /runLog\.result/i })
      expect(resultTab).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
    })

    it('should highlight DETAIL tab when currentTab is DETAIL', () => {
      render(
        <Tabs
          currentTab="DETAIL"
          workflowRunningData={createMockWorkflowRunningData()}
          switchTab={mockSwitchTab}
        />,
      )

      const detailTab = screen.getByRole('button', { name: /runLog\.detail/i })
      expect(detailTab).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
    })
  })

  // Tab click handling
  describe('Tab Click Handling', () => {
    it('should call switchTab with RESULT when RESULT tab is clicked', () => {
      render(
        <Tabs
          currentTab="DETAIL"
          workflowRunningData={createMockWorkflowRunningData()}
          switchTab={mockSwitchTab}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /runLog\.result/i }))

      expect(mockSwitchTab).toHaveBeenCalledWith('RESULT')
    })

    it('should call switchTab with DETAIL when DETAIL tab is clicked', () => {
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={createMockWorkflowRunningData()}
          switchTab={mockSwitchTab}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /runLog\.detail/i }))

      expect(mockSwitchTab).toHaveBeenCalledWith('DETAIL')
    })

    it('should call switchTab with TRACING when TRACING tab is clicked', () => {
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={createMockWorkflowRunningData()}
          switchTab={mockSwitchTab}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /runLog\.tracing/i }))

      expect(mockSwitchTab).toHaveBeenCalledWith('TRACING')
    })
  })

  // Disabled state when no data
  describe('Disabled State', () => {
    it('should disable tabs when workflowRunningData is undefined', () => {
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={undefined}
          switchTab={mockSwitchTab}
        />,
      )

      const resultTab = screen.getByRole('button', { name: /runLog\.result/i })
      expect(resultTab).toBeDisabled()
    })
  })
})

// ============================================================================
// Tab Component Tests
// ============================================================================

vi.doUnmock('./result/tabs/tab')

describe('Tab', () => {
  let Tab: typeof import('./result/tabs/tab').default

  beforeAll(async () => {
    const tabModule = await import('./result/tabs/tab')
    Tab = tabModule.default
  })

  const mockOnClick = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render tab with label', () => {
      render(
        <Tab
          isActive={false}
          label="Test Tab"
          value="TEST"
          workflowRunningData={createMockWorkflowRunningData()}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByRole('button', { name: 'Test Tab' })).toBeInTheDocument()
    })
  })

  // Active state styling
  describe('Active State', () => {
    it('should have active styles when isActive is true', () => {
      render(
        <Tab
          isActive={true}
          label="Active Tab"
          value="TEST"
          workflowRunningData={createMockWorkflowRunningData()}
          onClick={mockOnClick}
        />,
      )

      const tab = screen.getByRole('button')
      expect(tab).toHaveClass('border-util-colors-blue-brand-blue-brand-600', 'text-text-primary')
    })

    it('should have inactive styles when isActive is false', () => {
      render(
        <Tab
          isActive={false}
          label="Inactive Tab"
          value="TEST"
          workflowRunningData={createMockWorkflowRunningData()}
          onClick={mockOnClick}
        />,
      )

      const tab = screen.getByRole('button')
      expect(tab).toHaveClass('border-transparent', 'text-text-tertiary')
    })
  })

  // Click handling
  describe('Click Handling', () => {
    it('should call onClick with value when clicked', () => {
      render(
        <Tab
          isActive={false}
          label="Test Tab"
          value="MY_VALUE"
          workflowRunningData={createMockWorkflowRunningData()}
          onClick={mockOnClick}
        />,
      )

      fireEvent.click(screen.getByRole('button'))

      expect(mockOnClick).toHaveBeenCalledWith('MY_VALUE')
    })

    it('should not call onClick when disabled (no workflowRunningData)', () => {
      render(
        <Tab
          isActive={false}
          label="Test Tab"
          value="MY_VALUE"
          workflowRunningData={undefined}
          onClick={mockOnClick}
        />,
      )

      const tab = screen.getByRole('button')
      fireEvent.click(tab)

      // The click handler is still called, but button is disabled
      expect(tab).toBeDisabled()
    })
  })

  // Disabled state
  describe('Disabled State', () => {
    it('should be disabled when workflowRunningData is undefined', () => {
      render(
        <Tab
          isActive={false}
          label="Test Tab"
          value="TEST"
          workflowRunningData={undefined}
          onClick={mockOnClick}
        />,
      )

      const tab = screen.getByRole('button')
      expect(tab).toBeDisabled()
      expect(tab).toHaveClass('opacity-30')
    })

    it('should not be disabled when workflowRunningData is provided', () => {
      render(
        <Tab
          isActive={false}
          label="Test Tab"
          value="TEST"
          workflowRunningData={createMockWorkflowRunningData()}
          onClick={mockOnClick}
        />,
      )

      const tab = screen.getByRole('button')
      expect(tab).not.toBeDisabled()
    })
  })
})

// ============================================================================
// formatPreviewChunks Utility Tests
// ============================================================================

describe('formatPreviewChunks', () => {
  let formatPreviewChunks: typeof import('./result/result-preview/utils').formatPreviewChunks

  beforeAll(async () => {
    const utilsModule = await import('./result/result-preview/utils')
    formatPreviewChunks = utilsModule.formatPreviewChunks
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should return undefined for null outputs', () => {
      expect(formatPreviewChunks(null)).toBeUndefined()
    })

    it('should return undefined for undefined outputs', () => {
      expect(formatPreviewChunks(undefined)).toBeUndefined()
    })

    it('should return undefined for unknown chunk structure', () => {
      const outputs = {
        chunk_structure: 'unknown_mode',
        preview: [],
      }
      expect(formatPreviewChunks(outputs)).toBeUndefined()
    })
  })

  // General (text) chunks
  describe('General Chunks (ChunkingMode.text)', () => {
    it('should format general chunks correctly', () => {
      const outputs = createMockGeneralOutputs(['content1', 'content2', 'content3'])
      const result = formatPreviewChunks(outputs)

      expect(result).toEqual([
        { content: 'content1', summary: undefined },
        { content: 'content2', summary: undefined },
        { content: 'content3', summary: undefined },
      ])
    })

    it('should limit to RAG_PIPELINE_PREVIEW_CHUNK_NUM chunks', () => {
      const manyChunks = Array.from({ length: 10 }, (_, i) => `chunk${i}`)
      const outputs = createMockGeneralOutputs(manyChunks)
      const result = formatPreviewChunks(outputs) as GeneralChunks

      // RAG_PIPELINE_PREVIEW_CHUNK_NUM is mocked to 5
      expect(result).toHaveLength(5)
      expect(result).toEqual([
        { content: 'chunk0', summary: undefined },
        { content: 'chunk1', summary: undefined },
        { content: 'chunk2', summary: undefined },
        { content: 'chunk3', summary: undefined },
        { content: 'chunk4', summary: undefined },
      ])
    })

    it('should handle empty preview array', () => {
      const outputs = createMockGeneralOutputs([])
      const result = formatPreviewChunks(outputs)

      expect(result).toEqual([])
    })
  })

  // Parent-child chunks
  describe('Parent-Child Chunks (ChunkingMode.parentChild)', () => {
    it('should format paragraph mode parent-child chunks correctly', () => {
      const outputs = createMockParentChildOutputs('paragraph')
      const result = formatPreviewChunks(outputs)

      expect(result).toEqual({
        parent_child_chunks: [
          { parent_content: 'parent1', child_contents: ['child1', 'child2'], parent_mode: 'paragraph' },
          { parent_content: 'parent2', child_contents: ['child3', 'child4'], parent_mode: 'paragraph' },
        ],
        parent_mode: 'paragraph',
      })
    })

    it('should format full-doc mode parent-child chunks and limit child chunks', () => {
      const outputs = {
        chunk_structure: ChunkingMode.parentChild,
        parent_mode: 'full-doc' as const,
        preview: [
          {
            content: 'full-doc-parent',
            child_chunks: Array.from({ length: 10 }, (_, i) => `child${i}`),
          },
        ],
      }
      const result = formatPreviewChunks(outputs)

      expect(result).toEqual({
        parent_child_chunks: [
          {
            parent_content: 'full-doc-parent',
            child_contents: ['child0', 'child1', 'child2', 'child3', 'child4'], // Limited to 5
            parent_mode: 'full-doc',
          },
        ],
        parent_mode: 'full-doc',
      })
    })
  })

  // QA chunks
  describe('QA Chunks (ChunkingMode.qa)', () => {
    it('should format QA chunks correctly', () => {
      const outputs = createMockQAOutputs()
      const result = formatPreviewChunks(outputs)

      expect(result).toEqual({
        qa_chunks: [
          { question: 'Q1', answer: 'A1' },
          { question: 'Q2', answer: 'A2' },
        ],
      })
    })

    it('should limit QA chunks to RAG_PIPELINE_PREVIEW_CHUNK_NUM', () => {
      const outputs = {
        chunk_structure: ChunkingMode.qa,
        qa_preview: Array.from({ length: 10 }, (_, i) => ({
          question: `Q${i}`,
          answer: `A${i}`,
        })),
      }
      const result = formatPreviewChunks(outputs) as { qa_chunks: Array<{ question: string, answer: string }> }

      expect(result.qa_chunks).toHaveLength(5)
    })
  })
})

// ============================================================================
// Types Tests
// ============================================================================

describe('Types', () => {
  describe('TestRunStep Enum', () => {
    it('should have correct enum values', async () => {
      const { TestRunStep } = await import('./types')

      expect(TestRunStep.dataSource).toBe('dataSource')
      expect(TestRunStep.documentProcessing).toBe('documentProcessing')
    })
  })
})
