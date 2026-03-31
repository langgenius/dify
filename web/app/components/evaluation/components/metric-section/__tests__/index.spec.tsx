import { act, fireEvent, render, screen } from '@testing-library/react'
import MetricSection from '..'
import { useEvaluationStore } from '../../../store'

const mockUseAvailableEvaluationMetrics = vi.hoisted(() => vi.fn())
const mockUseEvaluationNodeInfoMutation = vi.hoisted(() => vi.fn())

vi.mock('@/service/use-evaluation', () => ({
  useAvailableEvaluationMetrics: (...args: unknown[]) => mockUseAvailableEvaluationMetrics(...args),
  useEvaluationNodeInfoMutation: (...args: unknown[]) => mockUseEvaluationNodeInfoMutation(...args),
}))

const resourceType = 'workflow' as const
const resourceId = 'metric-section-resource'

const renderMetricSection = () => {
  return render(<MetricSection resourceType={resourceType} resourceId={resourceId} />)
}

describe('MetricSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEvaluationStore.setState({ resources: {} })

    mockUseAvailableEvaluationMetrics.mockReturnValue({
      data: {
        metrics: ['answer-correctness'],
      },
      isLoading: false,
    })

    mockUseEvaluationNodeInfoMutation.mockReturnValue({
      isPending: false,
      mutate: vi.fn(),
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
      act(() => {
        useEvaluationStore.getState().addBuiltinMetric(resourceType, resourceId, 'answer-correctness', [
          { node_id: 'node-answer', title: 'Answer Node', type: 'llm' },
        ])
      })

      renderMetricSection()

      expect(screen.getByText('Answer Correctness')).toBeInTheDocument()
      expect(screen.getByText('Answer Node')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.remove' }))

      expect(screen.queryByText('Answer Correctness')).not.toBeInTheDocument()
      expect(screen.getByText('evaluation.metrics.description')).toBeInTheDocument()
    })

    it('should render the all-nodes label when a builtin metric has no node selection', () => {
      act(() => {
        useEvaluationStore.getState().addBuiltinMetric(resourceType, resourceId, 'answer-correctness', [])
      })

      renderMetricSection()

      expect(screen.getByText('evaluation.metrics.nodesAll')).toBeInTheDocument()
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
      expect(screen.getByText('evaluation.metrics.custom.title')).toBeInTheDocument()
      expect(screen.getByText('evaluation.metrics.custom.warningBadge')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'evaluation.metrics.custom.addMapping' })).toBeInTheDocument()
    })
  })
})
