import type { ChunkInfo, GeneralChunks, ParentChildChunks, QAChunks } from '@/app/components/rag-pipeline/components/chunk-card-list/types'
import type { WorkflowRunningData } from '@/app/components/workflow/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { BlockEnum, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { RAG_PIPELINE_PREVIEW_CHUNK_NUM } from '@/config'
import { ChunkingMode } from '@/models/datasets'
import Result from './index'
import ResultPreview from './result-preview'
import { formatPreviewChunks } from './result-preview/utils'
import Tabs from './tabs'
import Tab from './tabs/tab'

// ============================================================================
// Pre-declare variables used in mocks (hoisting)
// ============================================================================

let mockWorkflowRunningData: WorkflowRunningData | undefined

// ============================================================================
// Mock External Dependencies
// ============================================================================

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string, count?: number }) => {
      const ns = options?.ns ? `${options.ns}.` : ''
      if (options?.count !== undefined)
        return `${ns}${key} (count: ${options.count})`
      return `${ns}${key}`
    },
  }),
}))

// Mock workflow store
vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: { workflowRunningData: WorkflowRunningData | undefined }) => T) =>
    selector({ workflowRunningData: mockWorkflowRunningData }),
}))

// Mock child components
vi.mock('@/app/components/workflow/run/result-panel', () => ({
  default: ({
    inputs,
    outputs,
    status,
    error,
    elapsed_time,
    total_tokens,
    created_at,
    created_by,
    steps,
    exceptionCounts,
  }: {
    inputs?: string
    outputs?: string
    status?: string
    error?: string
    elapsed_time?: number
    total_tokens?: number
    created_at?: number
    created_by?: string
    steps?: number
    exceptionCounts?: number
  }) => (
    <div
      data-testid="result-panel"
      data-inputs={inputs}
      data-outputs={outputs}
      data-status={status}
      data-error={error}
      data-elapsed-time={elapsed_time}
      data-total-tokens={total_tokens}
      data-created-at={created_at}
      data-created-by={created_by}
      data-steps={steps}
      data-exception-counts={exceptionCounts}
    >
      ResultPanel
    </div>
  ),
}))

vi.mock('@/app/components/workflow/run/tracing-panel', () => ({
  default: ({ className, list }: { className?: string, list: unknown[] }) => (
    <div data-testid="tracing-panel" data-classname={className} data-list-length={list.length}>
      TracingPanel
    </div>
  ),
}))

vi.mock('@/app/components/rag-pipeline/components/chunk-card-list', () => ({
  ChunkCardList: ({ chunkType, chunkInfo }: { chunkType?: string, chunkInfo?: ChunkInfo }) => (
    <div
      data-testid="chunk-card-list"
      data-chunk-type={chunkType}
      data-chunk-info={JSON.stringify(chunkInfo)}
    >
      ChunkCardList
    </div>
  ),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createMockWorkflowRunningData = (
  overrides?: Partial<WorkflowRunningData>,
): WorkflowRunningData => ({
  task_id: 'test-task-id',
  message_id: 'test-message-id',
  conversation_id: 'test-conversation-id',
  result: {
    workflow_id: 'test-workflow-id',
    inputs: '{"input": "test"}',
    inputs_truncated: false,
    process_data: '{}',
    process_data_truncated: false,
    outputs: '{"output": "test"}',
    outputs_truncated: false,
    status: WorkflowRunningStatus.Succeeded,
    elapsed_time: 1000,
    total_tokens: 100,
    created_at: Date.now(),
    created_by: 'test-user',
    total_steps: 5,
    exceptions_count: 0,
  },
  tracing: [
    {
      id: 'node-1',
      index: 1,
      predecessor_node_id: '',
      node_id: 'node-1',
      node_type: BlockEnum.Start,
      title: 'Start',
      inputs: {},
      inputs_truncated: false,
      process_data: {},
      process_data_truncated: false,
      outputs: {},
      outputs_truncated: false,
      status: 'succeeded',
      elapsed_time: 100,
      execution_metadata: {
        total_tokens: 0,
        total_price: 0,
        currency: 'USD',
      },
      metadata: {
        iterator_length: 0,
        iterator_index: 0,
        loop_length: 0,
        loop_index: 0,
      },
      created_at: Date.now(),
      created_by: {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
      },
      finished_at: Date.now(),
    },
  ],
  ...overrides,
})

const createGeneralChunkOutputs = (chunkCount: number = 5) => ({
  chunk_structure: ChunkingMode.text,
  preview: Array.from({ length: chunkCount }, (_, i) => ({
    content: `General chunk content ${i + 1}`,
  })),
})

const createParentChildChunkOutputs = (parentMode: 'paragraph' | 'full-doc', parentCount: number = 3) => ({
  chunk_structure: ChunkingMode.parentChild,
  parent_mode: parentMode,
  preview: Array.from({ length: parentCount }, (_, i) => ({
    content: `Parent content ${i + 1}`,
    child_chunks: [`Child 1 of parent ${i + 1}`, `Child 2 of parent ${i + 1}`],
  })),
})

const createQAChunkOutputs = (qaCount: number = 5) => ({
  chunk_structure: ChunkingMode.qa,
  qa_preview: Array.from({ length: qaCount }, (_, i) => ({
    question: `Question ${i + 1}`,
    answer: `Answer ${i + 1}`,
  })),
})

// ============================================================================
// Helper Functions
// ============================================================================

const resetAllMocks = () => {
  mockWorkflowRunningData = undefined
}

// ============================================================================
// Tab Component Tests
// ============================================================================

describe('Tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render tab with label', () => {
      const mockOnClick = vi.fn()

      render(
        <Tab
          isActive={false}
          label="Test Tab"
          value="test"
          workflowRunningData={createMockWorkflowRunningData()}
          onClick={mockOnClick}
        />,
      )

      expect(screen.getByRole('button')).toHaveTextContent('Test Tab')
    })

    it('should apply active styles when isActive is true', () => {
      const mockOnClick = vi.fn()

      render(
        <Tab
          isActive={true}
          label="Active Tab"
          value="active"
          workflowRunningData={createMockWorkflowRunningData()}
          onClick={mockOnClick}
        />,
      )

      const button = screen.getByRole('button')
      expect(button).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
      expect(button).toHaveClass('text-text-primary')
    })

    it('should apply inactive styles when isActive is false', () => {
      const mockOnClick = vi.fn()

      render(
        <Tab
          isActive={false}
          label="Inactive Tab"
          value="inactive"
          workflowRunningData={createMockWorkflowRunningData()}
          onClick={mockOnClick}
        />,
      )

      const button = screen.getByRole('button')
      expect(button).toHaveClass('border-transparent')
      expect(button).toHaveClass('text-text-tertiary')
    })

    it('should apply disabled styles when workflowRunningData is undefined', () => {
      const mockOnClick = vi.fn()

      render(
        <Tab
          isActive={false}
          label="Disabled Tab"
          value="disabled"
          workflowRunningData={undefined}
          onClick={mockOnClick}
        />,
      )

      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
      expect(button).toHaveClass('opacity-30')
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onClick with value when clicked', () => {
      const mockOnClick = vi.fn()

      render(
        <Tab
          isActive={false}
          label="Clickable Tab"
          value="click-value"
          workflowRunningData={createMockWorkflowRunningData()}
          onClick={mockOnClick}
        />,
      )

      fireEvent.click(screen.getByRole('button'))

      expect(mockOnClick).toHaveBeenCalledTimes(1)
      expect(mockOnClick).toHaveBeenCalledWith('click-value')
    })

    it('should not call onClick when disabled', () => {
      const mockOnClick = vi.fn()

      render(
        <Tab
          isActive={false}
          label="Disabled Tab"
          value="disabled-value"
          workflowRunningData={undefined}
          onClick={mockOnClick}
        />,
      )

      fireEvent.click(screen.getByRole('button'))

      expect(mockOnClick).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should maintain stable handleClick callback reference', () => {
      const mockOnClick = vi.fn()

      const TestComponent = ({ onClick }: { onClick: (value: string) => void }) => (
        <Tab
          isActive={false}
          label="Test"
          value="test"
          workflowRunningData={createMockWorkflowRunningData()}
          onClick={onClick}
        />
      )

      const { rerender } = render(<TestComponent onClick={mockOnClick} />)

      fireEvent.click(screen.getByRole('button'))
      expect(mockOnClick).toHaveBeenCalledTimes(1)

      rerender(<TestComponent onClick={mockOnClick} />)
      fireEvent.click(screen.getByRole('button'))
      expect(mockOnClick).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // Props Variation Tests
  // -------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should render with all combinations of isActive and workflowRunningData', () => {
      const mockOnClick = vi.fn()
      const workflowData = createMockWorkflowRunningData()

      // Active with data
      const { rerender } = render(
        <Tab isActive={true} label="Tab" value="tab" workflowRunningData={workflowData} onClick={mockOnClick} />,
      )
      expect(screen.getByRole('button')).not.toBeDisabled()

      // Inactive with data
      rerender(
        <Tab isActive={false} label="Tab" value="tab" workflowRunningData={workflowData} onClick={mockOnClick} />,
      )
      expect(screen.getByRole('button')).not.toBeDisabled()

      // Active without data
      rerender(
        <Tab isActive={true} label="Tab" value="tab" workflowRunningData={undefined} onClick={mockOnClick} />,
      )
      expect(screen.getByRole('button')).toBeDisabled()

      // Inactive without data
      rerender(
        <Tab isActive={false} label="Tab" value="tab" workflowRunningData={undefined} onClick={mockOnClick} />,
      )
      expect(screen.getByRole('button')).toBeDisabled()
    })
  })
})

// ============================================================================
// Tabs Component Tests
// ============================================================================

describe('Tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render all three tabs', () => {
      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={createMockWorkflowRunningData()}
          switchTab={vi.fn()}
        />,
      )

      expect(screen.getByText('runLog.result')).toBeInTheDocument()
      expect(screen.getByText('runLog.detail')).toBeInTheDocument()
      expect(screen.getByText('runLog.tracing')).toBeInTheDocument()
    })

    it('should render tabs container with correct styling', () => {
      const { container } = render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={createMockWorkflowRunningData()}
          switchTab={vi.fn()}
        />,
      )

      const tabsContainer = container.firstChild as HTMLElement
      expect(tabsContainer).toHaveClass('flex')
      expect(tabsContainer).toHaveClass('shrink-0')
      expect(tabsContainer).toHaveClass('border-b-[0.5px]')
    })

    it('should highlight the current tab', () => {
      render(
        <Tabs
          currentTab="DETAIL"
          workflowRunningData={createMockWorkflowRunningData()}
          switchTab={vi.fn()}
        />,
      )

      const buttons = screen.getAllByRole('button')
      // RESULT tab
      expect(buttons[0]).toHaveClass('border-transparent')
      // DETAIL tab (active)
      expect(buttons[1]).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
      // TRACING tab
      expect(buttons[2]).toHaveClass('border-transparent')
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call switchTab when RESULT tab is clicked', () => {
      const mockSwitchTab = vi.fn()

      render(
        <Tabs
          currentTab="DETAIL"
          workflowRunningData={createMockWorkflowRunningData()}
          switchTab={mockSwitchTab}
        />,
      )

      fireEvent.click(screen.getByText('runLog.result'))

      expect(mockSwitchTab).toHaveBeenCalledWith('RESULT')
    })

    it('should call switchTab when DETAIL tab is clicked', () => {
      const mockSwitchTab = vi.fn()

      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={createMockWorkflowRunningData()}
          switchTab={mockSwitchTab}
        />,
      )

      fireEvent.click(screen.getByText('runLog.detail'))

      expect(mockSwitchTab).toHaveBeenCalledWith('DETAIL')
    })

    it('should call switchTab when TRACING tab is clicked', () => {
      const mockSwitchTab = vi.fn()

      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={createMockWorkflowRunningData()}
          switchTab={mockSwitchTab}
        />,
      )

      fireEvent.click(screen.getByText('runLog.tracing'))

      expect(mockSwitchTab).toHaveBeenCalledWith('TRACING')
    })

    it('should disable all tabs when workflowRunningData is undefined', () => {
      const mockSwitchTab = vi.fn()

      render(
        <Tabs
          currentTab="RESULT"
          workflowRunningData={undefined}
          switchTab={mockSwitchTab}
        />,
      )

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toBeDisabled()
      })

      fireEvent.click(buttons[0])
      expect(mockSwitchTab).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Props Variation Tests
  // -------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should handle all currentTab values', () => {
      const mockSwitchTab = vi.fn()
      const workflowData = createMockWorkflowRunningData()

      const { rerender } = render(
        <Tabs currentTab="RESULT" workflowRunningData={workflowData} switchTab={mockSwitchTab} />,
      )

      let buttons = screen.getAllByRole('button')
      expect(buttons[0]).toHaveClass('border-util-colors-blue-brand-blue-brand-600')

      rerender(
        <Tabs currentTab="DETAIL" workflowRunningData={workflowData} switchTab={mockSwitchTab} />,
      )

      buttons = screen.getAllByRole('button')
      expect(buttons[1]).toHaveClass('border-util-colors-blue-brand-blue-brand-600')

      rerender(
        <Tabs currentTab="TRACING" workflowRunningData={workflowData} switchTab={mockSwitchTab} />,
      )

      buttons = screen.getAllByRole('button')
      expect(buttons[2]).toHaveClass('border-util-colors-blue-brand-blue-brand-600')
    })
  })
})

// ============================================================================
// formatPreviewChunks Utility Tests
// ============================================================================

describe('formatPreviewChunks', () => {
  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should return undefined when outputs is null', () => {
      expect(formatPreviewChunks(null)).toBeUndefined()
    })

    it('should return undefined when outputs is undefined', () => {
      expect(formatPreviewChunks(undefined)).toBeUndefined()
    })

    it('should return undefined for unknown chunk_structure', () => {
      const outputs = {
        chunk_structure: 'unknown_mode' as ChunkingMode,
        preview: [],
      }

      expect(formatPreviewChunks(outputs)).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // General Chunks Tests
  // -------------------------------------------------------------------------
  describe('General Chunks (text mode)', () => {
    it('should format general chunks correctly', () => {
      const outputs = createGeneralChunkOutputs(3)
      const result = formatPreviewChunks(outputs) as GeneralChunks

      expect(result).toHaveLength(3)
      expect((result as GeneralChunks)[0].content).toBe('General chunk content 1')
      expect((result as GeneralChunks)[1].content).toBe('General chunk content 2')
      expect((result as GeneralChunks)[2].content).toBe('General chunk content 3')
    })

    it('should limit chunks to RAG_PIPELINE_PREVIEW_CHUNK_NUM', () => {
      const outputs = createGeneralChunkOutputs(RAG_PIPELINE_PREVIEW_CHUNK_NUM + 10)
      const result = formatPreviewChunks(outputs) as GeneralChunks

      expect(result).toHaveLength(RAG_PIPELINE_PREVIEW_CHUNK_NUM)
    })

    it('should handle empty preview array', () => {
      const outputs = {
        chunk_structure: ChunkingMode.text,
        preview: [],
      }
      const result = formatPreviewChunks(outputs) as GeneralChunks

      expect(result).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // Parent-Child Chunks Tests
  // -------------------------------------------------------------------------
  describe('Parent-Child Chunks (hierarchical mode)', () => {
    it('should format paragraph mode chunks correctly', () => {
      const outputs = createParentChildChunkOutputs('paragraph', 3)
      const result = formatPreviewChunks(outputs) as ParentChildChunks

      expect(result.parent_mode).toBe('paragraph')
      expect(result.parent_child_chunks).toHaveLength(3)
      expect(result.parent_child_chunks[0].parent_content).toBe('Parent content 1')
      expect(result.parent_child_chunks[0].child_contents).toEqual([
        'Child 1 of parent 1',
        'Child 2 of parent 1',
      ])
    })

    it('should limit paragraph mode chunks to RAG_PIPELINE_PREVIEW_CHUNK_NUM', () => {
      const outputs = createParentChildChunkOutputs('paragraph', RAG_PIPELINE_PREVIEW_CHUNK_NUM + 5)
      const result = formatPreviewChunks(outputs) as ParentChildChunks

      expect(result.parent_child_chunks).toHaveLength(RAG_PIPELINE_PREVIEW_CHUNK_NUM)
    })

    it('should format full-doc mode chunks correctly', () => {
      const outputs = createParentChildChunkOutputs('full-doc', 2)
      const result = formatPreviewChunks(outputs) as ParentChildChunks

      expect(result.parent_mode).toBe('full-doc')
      expect(result.parent_child_chunks).toHaveLength(2)
    })

    it('should limit full-doc mode child chunks to RAG_PIPELINE_PREVIEW_CHUNK_NUM', () => {
      const outputs = {
        chunk_structure: ChunkingMode.parentChild,
        parent_mode: 'full-doc',
        preview: [
          {
            content: 'Parent content',
            child_chunks: Array.from(
              { length: RAG_PIPELINE_PREVIEW_CHUNK_NUM + 10 },
              (_, i) => `Child ${i + 1}`,
            ),
          },
        ],
      }
      const result = formatPreviewChunks(outputs) as ParentChildChunks

      expect(result.parent_child_chunks[0].child_contents).toHaveLength(
        RAG_PIPELINE_PREVIEW_CHUNK_NUM,
      )
    })

    it('should handle empty preview array for parent-child mode', () => {
      const outputs = {
        chunk_structure: ChunkingMode.parentChild,
        parent_mode: 'paragraph',
        preview: [],
      }
      const result = formatPreviewChunks(outputs) as ParentChildChunks

      expect(result.parent_child_chunks).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // QA Chunks Tests
  // -------------------------------------------------------------------------
  describe('QA Chunks (qa mode)', () => {
    it('should format QA chunks correctly', () => {
      const outputs = createQAChunkOutputs(3)
      const result = formatPreviewChunks(outputs) as QAChunks

      expect(result.qa_chunks).toHaveLength(3)
      expect(result.qa_chunks[0].question).toBe('Question 1')
      expect(result.qa_chunks[0].answer).toBe('Answer 1')
    })

    it('should limit QA chunks to RAG_PIPELINE_PREVIEW_CHUNK_NUM', () => {
      const outputs = createQAChunkOutputs(RAG_PIPELINE_PREVIEW_CHUNK_NUM + 10)
      const result = formatPreviewChunks(outputs) as QAChunks

      expect(result.qa_chunks).toHaveLength(RAG_PIPELINE_PREVIEW_CHUNK_NUM)
    })

    it('should handle empty qa_preview array', () => {
      const outputs = {
        chunk_structure: ChunkingMode.qa,
        qa_preview: [],
      }
      const result = formatPreviewChunks(outputs) as QAChunks

      expect(result.qa_chunks).toHaveLength(0)
    })
  })
})

// ============================================================================
// ResultPreview Component Tests
// ============================================================================

describe('ResultPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render loading state when isRunning is true and no outputs', () => {
      render(
        <ResultPreview
          isRunning={true}
          outputs={undefined}
          error={undefined}
          onSwitchToDetail={vi.fn()}
        />,
      )

      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
    })

    it('should render error state when not running and has error', () => {
      render(
        <ResultPreview
          isRunning={false}
          outputs={undefined}
          error="Something went wrong"
          onSwitchToDetail={vi.fn()}
        />,
      )

      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
      expect(screen.getByText('pipeline.result.resultPreview.viewDetails')).toBeInTheDocument()
    })

    it('should render ChunkCardList when outputs are available', () => {
      const outputs = createGeneralChunkOutputs(5)

      render(
        <ResultPreview
          isRunning={false}
          outputs={outputs}
          error={undefined}
          onSwitchToDetail={vi.fn()}
        />,
      )

      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })

    it('should render footer tip with correct count', () => {
      const outputs = createGeneralChunkOutputs(5)

      render(
        <ResultPreview
          isRunning={false}
          outputs={outputs}
          error={undefined}
          onSwitchToDetail={vi.fn()}
        />,
      )

      expect(
        screen.getByText(`pipeline.result.resultPreview.footerTip (count: ${RAG_PIPELINE_PREVIEW_CHUNK_NUM})`),
      ).toBeInTheDocument()
    })

    it('should not show loading when isRunning but outputs exist', () => {
      const outputs = createGeneralChunkOutputs(5)

      render(
        <ResultPreview
          isRunning={true}
          outputs={outputs}
          error={undefined}
          onSwitchToDetail={vi.fn()}
        />,
      )

      expect(screen.queryByText('pipeline.result.resultPreview.loading')).not.toBeInTheDocument()
      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onSwitchToDetail when view details button is clicked', () => {
      const mockOnSwitchToDetail = vi.fn()

      render(
        <ResultPreview
          isRunning={false}
          outputs={undefined}
          error="Error occurred"
          onSwitchToDetail={mockOnSwitchToDetail}
        />,
      )

      fireEvent.click(screen.getByText('pipeline.result.resultPreview.viewDetails'))

      expect(mockOnSwitchToDetail).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // Props Variation Tests
  // -------------------------------------------------------------------------
  describe('Props Variations', () => {
    it('should render with general chunks output', () => {
      const outputs = createGeneralChunkOutputs(3)

      render(
        <ResultPreview
          isRunning={false}
          outputs={outputs}
          error={undefined}
          onSwitchToDetail={vi.fn()}
        />,
      )

      const chunkCardList = screen.getByTestId('chunk-card-list')
      expect(chunkCardList).toHaveAttribute('data-chunk-type', ChunkingMode.text)
    })

    it('should render with parent-child chunks output', () => {
      const outputs = createParentChildChunkOutputs('paragraph', 3)

      render(
        <ResultPreview
          isRunning={false}
          outputs={outputs}
          error={undefined}
          onSwitchToDetail={vi.fn()}
        />,
      )

      const chunkCardList = screen.getByTestId('chunk-card-list')
      expect(chunkCardList).toHaveAttribute('data-chunk-type', ChunkingMode.parentChild)
    })

    it('should render with QA chunks output', () => {
      const outputs = createQAChunkOutputs(3)

      render(
        <ResultPreview
          isRunning={false}
          outputs={outputs}
          error={undefined}
          onSwitchToDetail={vi.fn()}
        />,
      )

      const chunkCardList = screen.getByTestId('chunk-card-list')
      expect(chunkCardList).toHaveAttribute('data-chunk-type', ChunkingMode.qa)
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle outputs with no previewChunks result', () => {
      const outputs = {
        chunk_structure: 'unknown_mode' as ChunkingMode,
        preview: [],
      }

      render(
        <ResultPreview
          isRunning={false}
          outputs={outputs}
          error={undefined}
          onSwitchToDetail={vi.fn()}
        />,
      )

      // Should not render chunk card list when formatPreviewChunks returns undefined
      expect(screen.queryByTestId('chunk-card-list')).not.toBeInTheDocument()
    })

    it('should not render error section when running', () => {
      render(
        <ResultPreview
          isRunning={true}
          outputs={undefined}
          error="Error"
          onSwitchToDetail={vi.fn()}
        />,
      )

      // Error section should not render when isRunning is true
      expect(screen.queryByText('pipeline.result.resultPreview.error')).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should memoize previewChunks calculation', () => {
      const outputs = createGeneralChunkOutputs(3)
      const { rerender } = render(
        <ResultPreview
          isRunning={false}
          outputs={outputs}
          error={undefined}
          onSwitchToDetail={vi.fn()}
        />,
      )

      // Re-render with same outputs - should use memoized value
      rerender(
        <ResultPreview
          isRunning={false}
          outputs={outputs}
          error={undefined}
          onSwitchToDetail={vi.fn()}
        />,
      )

      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })
  })
})

// ============================================================================
// Result Component Tests (Main Component)
// ============================================================================

describe('Result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAllMocks()
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render tabs and result preview by default', () => {
      mockWorkflowRunningData = createMockWorkflowRunningData({
        result: {
          ...createMockWorkflowRunningData().result,
          status: WorkflowRunningStatus.Running,
          outputs: undefined,
        },
      })

      render(<Result />)

      // Tabs should be rendered
      expect(screen.getByText('runLog.result')).toBeInTheDocument()
      expect(screen.getByText('runLog.detail')).toBeInTheDocument()
      expect(screen.getByText('runLog.tracing')).toBeInTheDocument()
    })

    it('should render loading state for RESULT tab when running without outputs', () => {
      mockWorkflowRunningData = createMockWorkflowRunningData({
        result: {
          ...createMockWorkflowRunningData().result,
          status: WorkflowRunningStatus.Running,
          outputs: undefined,
        },
      })

      render(<Result />)

      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
    })

    it('should render result preview when result has outputs', () => {
      const outputs = createGeneralChunkOutputs(3)
      mockWorkflowRunningData = createMockWorkflowRunningData({
        result: {
          ...createMockWorkflowRunningData().result,
          status: WorkflowRunningStatus.Succeeded,
          outputs: outputs as unknown as string,
        },
      })

      render(<Result />)

      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Tab Switching Tests
  // -------------------------------------------------------------------------
  describe('Tab Switching', () => {
    it('should switch to DETAIL tab when clicked', async () => {
      mockWorkflowRunningData = createMockWorkflowRunningData()

      render(<Result />)

      fireEvent.click(screen.getByText('runLog.detail'))

      await waitFor(() => {
        expect(screen.getByTestId('result-panel')).toBeInTheDocument()
      })
    })

    it('should switch to TRACING tab when clicked', async () => {
      mockWorkflowRunningData = createMockWorkflowRunningData()

      render(<Result />)

      fireEvent.click(screen.getByText('runLog.tracing'))

      await waitFor(() => {
        expect(screen.getByTestId('tracing-panel')).toBeInTheDocument()
      })
    })

    it('should switch back to RESULT tab from other tabs', async () => {
      const outputs = createGeneralChunkOutputs(3)
      mockWorkflowRunningData = createMockWorkflowRunningData({
        result: {
          ...createMockWorkflowRunningData().result,
          outputs: outputs as unknown as string,
        },
      })

      render(<Result />)

      // Switch to DETAIL
      fireEvent.click(screen.getByText('runLog.detail'))
      await waitFor(() => {
        expect(screen.getByTestId('result-panel')).toBeInTheDocument()
      })

      // Switch back to RESULT
      fireEvent.click(screen.getByText('runLog.result'))
      await waitFor(() => {
        expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // DETAIL Tab Content Tests
  // -------------------------------------------------------------------------
  describe('DETAIL Tab Content', () => {
    it('should render ResultPanel with correct props', async () => {
      mockWorkflowRunningData = createMockWorkflowRunningData({
        result: {
          ...createMockWorkflowRunningData().result,
          inputs: '{"key": "value"}',
          outputs: '{"result": "success"}',
          status: WorkflowRunningStatus.Succeeded,
          error: undefined,
          elapsed_time: 1500,
          total_tokens: 200,
          created_at: 1700000000000,
          created_by: { name: 'Test User' } as unknown as string,
          total_steps: 10,
          exceptions_count: 2,
        },
      })

      render(<Result />)

      fireEvent.click(screen.getByText('runLog.detail'))

      await waitFor(() => {
        const resultPanel = screen.getByTestId('result-panel')
        expect(resultPanel).toHaveAttribute('data-inputs', '{"key": "value"}')
        expect(resultPanel).toHaveAttribute('data-outputs', '{"result": "success"}')
        expect(resultPanel).toHaveAttribute('data-status', WorkflowRunningStatus.Succeeded)
        expect(resultPanel).toHaveAttribute('data-elapsed-time', '1500')
        expect(resultPanel).toHaveAttribute('data-total-tokens', '200')
        expect(resultPanel).toHaveAttribute('data-steps', '10')
        expect(resultPanel).toHaveAttribute('data-exception-counts', '2')
      })
    })

    it('should show loading when DETAIL tab is active but no result', async () => {
      mockWorkflowRunningData = {
        ...createMockWorkflowRunningData(),
        result: undefined as unknown as WorkflowRunningData['result'],
      }

      render(<Result />)

      fireEvent.click(screen.getByText('runLog.detail'))

      await waitFor(() => {
        expect(screen.getByTestId('result-panel')).toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // TRACING Tab Content Tests
  // -------------------------------------------------------------------------
  describe('TRACING Tab Content', () => {
    it('should render TracingPanel with tracing data', async () => {
      mockWorkflowRunningData = createMockWorkflowRunningData()

      render(<Result />)

      fireEvent.click(screen.getByText('runLog.tracing'))

      await waitFor(() => {
        const tracingPanel = screen.getByTestId('tracing-panel')
        expect(tracingPanel).toHaveAttribute('data-list-length', '1')
        expect(tracingPanel).toHaveAttribute('data-classname', 'bg-background-section-burn')
      })
    })

    it('should show loading when TRACING tab is active but no tracing data', async () => {
      mockWorkflowRunningData = createMockWorkflowRunningData({
        tracing: [],
      })

      render(<Result />)

      fireEvent.click(screen.getByText('runLog.tracing'))

      await waitFor(() => {
        // Both TracingPanel and Loading should be rendered
        expect(screen.getByTestId('tracing-panel')).toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Switch to Detail from Result Preview Tests
  // -------------------------------------------------------------------------
  describe('Switch to Detail from Result Preview', () => {
    it('should switch to DETAIL tab when onSwitchToDetail is triggered from ResultPreview', async () => {
      mockWorkflowRunningData = createMockWorkflowRunningData({
        result: {
          ...createMockWorkflowRunningData().result,
          status: WorkflowRunningStatus.Failed,
          error: 'Workflow failed',
          outputs: undefined,
        },
      })

      render(<Result />)

      // Click the view details button in error state
      fireEvent.click(screen.getByText('pipeline.result.resultPreview.viewDetails'))

      await waitFor(() => {
        expect(screen.getByTestId('result-panel')).toBeInTheDocument()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle undefined workflowRunningData', () => {
      mockWorkflowRunningData = undefined

      render(<Result />)

      // All tabs should be disabled
      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toBeDisabled()
      })
    })

    it('should handle workflowRunningData with no result', () => {
      mockWorkflowRunningData = {
        task_id: 'test-task',
        result: undefined as unknown as WorkflowRunningData['result'],
        tracing: [],
      }

      render(<Result />)

      // Should show loading in RESULT tab (isRunning condition)
      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
    })

    it('should handle result with Running status', () => {
      mockWorkflowRunningData = createMockWorkflowRunningData({
        result: {
          ...createMockWorkflowRunningData().result,
          status: WorkflowRunningStatus.Running,
          outputs: undefined,
        },
      })

      render(<Result />)

      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
    })

    it('should handle result with Stopped status', () => {
      mockWorkflowRunningData = createMockWorkflowRunningData({
        result: {
          ...createMockWorkflowRunningData().result,
          status: WorkflowRunningStatus.Stopped,
          outputs: undefined,
          error: 'Workflow was stopped',
        },
      })

      render(<Result />)

      // Should show error when stopped
      expect(screen.getByText('pipeline.result.resultPreview.error')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // State Management Tests
  // -------------------------------------------------------------------------
  describe('State Management', () => {
    it('should maintain tab state across re-renders', async () => {
      mockWorkflowRunningData = createMockWorkflowRunningData()

      const { rerender } = render(<Result />)

      // Switch to DETAIL tab
      fireEvent.click(screen.getByText('runLog.detail'))

      await waitFor(() => {
        expect(screen.getByTestId('result-panel')).toBeInTheDocument()
      })

      // Re-render component
      rerender(<Result />)

      // Should still be on DETAIL tab
      expect(screen.getByTestId('result-panel')).toBeInTheDocument()
    })

    it('should render different states based on workflowRunningData', () => {
      // Test 1: Running state with no outputs
      mockWorkflowRunningData = createMockWorkflowRunningData({
        result: {
          ...createMockWorkflowRunningData().result,
          status: WorkflowRunningStatus.Running,
          outputs: undefined,
        },
      })

      const { unmount } = render(<Result />)
      expect(screen.getByText('pipeline.result.resultPreview.loading')).toBeInTheDocument()
      unmount()

      // Test 2: Completed state with outputs
      const outputs = createGeneralChunkOutputs(3)
      mockWorkflowRunningData = createMockWorkflowRunningData({
        result: {
          ...createMockWorkflowRunningData().result,
          status: WorkflowRunningStatus.Succeeded,
          outputs: outputs as unknown as string,
        },
      })

      render(<Result />)
      expect(screen.getByTestId('chunk-card-list')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized', () => {
      mockWorkflowRunningData = createMockWorkflowRunningData()

      const { rerender } = render(<Result />)

      // Re-render without changes
      rerender(<Result />)

      // Component should still be rendered correctly
      expect(screen.getByText('runLog.result')).toBeInTheDocument()
    })
  })
})
