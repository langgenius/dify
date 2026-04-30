import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import MetricSection from '..'
import { useEvaluationStore } from '../../../store'

const mockUseAvailableEvaluationWorkflows = vi.hoisted(() => vi.fn())
const mockUseDefaultEvaluationMetrics = vi.hoisted(() => vi.fn())

vi.mock('@/service/use-evaluation', () => ({
  useAvailableEvaluationWorkflows: (...args: unknown[]) => mockUseAvailableEvaluationWorkflows(...args),
  useDefaultEvaluationMetrics: (...args: unknown[]) => mockUseDefaultEvaluationMetrics(...args),
}))

const resourceType = 'apps' as const
const resourceId = 'metric-section-resource'

const renderMetricSection = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MetricSection resourceType={resourceType} resourceId={resourceId} />
    </QueryClientProvider>,
  )
}

describe('MetricSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEvaluationStore.setState({ resources: {} })

    mockUseDefaultEvaluationMetrics.mockReturnValue({
      data: {
        default_metrics: [
          {
            metric: 'answer-correctness',
            value_type: 'number',
            node_info_list: [
              { node_id: 'node-answer', title: 'Answer Node', type: 'llm' },
            ],
          },
        ],
      },
      isLoading: false,
    })

    mockUseAvailableEvaluationWorkflows.mockReturnValue({
      data: {
        pages: [{ items: [], page: 1, limit: 20, has_more: false }],
      },
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetching: false,
      isFetchingNextPage: false,
      isLoading: false,
    })
  })

  // Verify the empty state block extracted from MetricSection.
  describe('Empty State', () => {
    it('should render the metric empty state when no metrics are selected', () => {
      renderMetricSection()

      expect(screen.getByText('evaluation.metrics.description')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'evaluation.metrics.add' })).toBeInTheDocument()
    })
  })

  // Verify the extracted builtin metric card presentation and removal flow.
  describe('Builtin Metric Card', () => {
    it('should render node badges for a builtin metric and remove it when delete is clicked', () => {
      // Arrange
      act(() => {
        useEvaluationStore.getState().addBuiltinMetric(resourceType, resourceId, 'answer-correctness', [
          { node_id: 'node-answer', title: 'Answer Node', type: 'llm' },
        ])
      })

      // Act
      renderMetricSection()

      // Assert
      expect(screen.getByText('Answer Correctness')).toBeInTheDocument()
      expect(screen.getByText('Answer Node')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.remove' }))

      expect(screen.queryByText('Answer Correctness')).not.toBeInTheDocument()
      expect(screen.getByText('evaluation.metrics.description')).toBeInTheDocument()
    })

    it('should render the all-nodes label when a builtin metric has no node selection', () => {
      // Arrange
      act(() => {
        useEvaluationStore.getState().addBuiltinMetric(resourceType, resourceId, 'answer-correctness', [])
      })

      // Act
      renderMetricSection()

      // Assert
      expect(screen.getByText('evaluation.metrics.nodesAll')).toBeInTheDocument()
    })

    it('should collapse and expand the node section when the metric header is clicked', () => {
      // Arrange
      act(() => {
        useEvaluationStore.getState().addBuiltinMetric(resourceType, resourceId, 'answer-correctness', [
          { node_id: 'node-answer', title: 'Answer Node', type: 'llm' },
        ])
      })

      // Act
      renderMetricSection()

      const toggleButton = screen.getByRole('button', { name: 'evaluation.metrics.collapseNodes' })
      fireEvent.click(toggleButton)

      // Assert
      expect(screen.queryByText('Answer Node')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'evaluation.metrics.expandNodes' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.expandNodes' }))

      expect(screen.getByText('Answer Node')).toBeInTheDocument()
    })

    it('should remove the builtin metric when removing its last selected node', () => {
      // Arrange
      act(() => {
        useEvaluationStore.getState().addBuiltinMetric(resourceType, resourceId, 'answer-correctness', [
          { node_id: 'node-answer', title: 'Answer Node', type: 'llm' },
        ])
      })

      // Act
      renderMetricSection()
      fireEvent.click(screen.getByRole('button', { name: 'Answer Node' }))

      // Assert
      expect(screen.queryByText('Answer Correctness')).not.toBeInTheDocument()
      expect(useEvaluationStore.getState().resources[`${resourceType}:${resourceId}`]!.metrics).toHaveLength(0)
    })

    it('should show only unselected nodes in the add-node dropdown and append the selected node', () => {
      // Arrange
      mockUseDefaultEvaluationMetrics.mockReturnValue({
        data: {
          default_metrics: [
            {
              metric: 'answer-correctness',
              value_type: 'number',
              node_info_list: [
                { node_id: 'node-1', title: 'LLM 1', type: 'llm' },
                { node_id: 'node-2', title: 'LLM 2', type: 'llm' },
              ],
            },
          ],
        },
        isLoading: false,
      })

      act(() => {
        useEvaluationStore.getState().addBuiltinMetric(resourceType, resourceId, 'answer-correctness', [
          { node_id: 'node-1', title: 'LLM 1', type: 'llm' },
        ])
      })

      // Act
      renderMetricSection()

      fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.addNode' }))

      // Assert
      expect(screen.queryByRole('menuitem', { name: 'LLM 1' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('menuitem', { name: 'LLM 2' }))

      expect(screen.getByText('LLM 2')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'evaluation.metrics.addNode' })).not.toBeInTheDocument()
    })

    it('should hide the add-node button when the builtin metric already targets all nodes', () => {
      // Arrange
      mockUseDefaultEvaluationMetrics.mockReturnValue({
        data: {
          default_metrics: [
            {
              metric: 'answer-correctness',
              value_type: 'number',
              node_info_list: [
                { node_id: 'node-1', title: 'LLM 1', type: 'llm' },
                { node_id: 'node-2', title: 'LLM 2', type: 'llm' },
              ],
            },
          ],
        },
        isLoading: false,
      })

      act(() => {
        useEvaluationStore.getState().addBuiltinMetric(resourceType, resourceId, 'answer-correctness', [])
      })

      // Act
      renderMetricSection()

      // Assert
      expect(screen.getByText('evaluation.metrics.nodesAll')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'evaluation.metrics.addNode' })).not.toBeInTheDocument()
    })
  })

  // Verify the extracted custom metric editor card renders inside the metric card.
  describe('Custom Metric Card', () => {
    it('should render the custom metric editor card when a custom metric is added', () => {
      act(() => {
        useEvaluationStore.getState().addCustomMetric(resourceType, resourceId)
      })

      renderMetricSection()

      expect(screen.getByText('Custom Evaluator')).toBeInTheDocument()
      expect(screen.getByText('evaluation.metrics.custom.warningBadge')).toBeInTheDocument()
      expect(screen.getByText('evaluation.metrics.custom.workflowPlaceholder')).toBeInTheDocument()
      expect(screen.getByText('evaluation.metrics.custom.mappingTitle')).toBeInTheDocument()
    })

    it('should disable adding another custom metric when one already exists', () => {
      // Arrange
      act(() => {
        useEvaluationStore.getState().addCustomMetric(resourceType, resourceId)
      })

      // Act
      renderMetricSection()
      fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.add' }))

      // Assert
      expect(screen.getByRole('button', { name: /evaluation.metrics.custom.footerTitle/i })).toBeDisabled()
      expect(screen.getByText('evaluation.metrics.custom.limitDescription')).toBeInTheDocument()
    })
  })
})
