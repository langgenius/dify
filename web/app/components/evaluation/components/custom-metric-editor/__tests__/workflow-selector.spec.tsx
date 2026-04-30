import type { ComponentProps } from 'react'
import type { AvailableEvaluationWorkflow } from '@/types/evaluation'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import WorkflowSelector from '../workflow-selector'

const mockUseAvailableEvaluationWorkflows = vi.hoisted(() => vi.fn())
const mockUseInfiniteScroll = vi.hoisted(() => vi.fn())

let loadMoreHandler: (() => Promise<{ list: unknown[] }>) | null = null

vi.mock('@/service/use-evaluation', () => ({
  useAvailableEvaluationWorkflows: (...args: unknown[]) => mockUseAvailableEvaluationWorkflows(...args),
}))

vi.mock('ahooks', () => ({
  useInfiniteScroll: (...args: unknown[]) => mockUseInfiniteScroll(...args),
}))

const createWorkflow = (
  overrides: Partial<AvailableEvaluationWorkflow> = {},
): AvailableEvaluationWorkflow => ({
  id: 'workflow-1',
  app_id: 'app-1',
  app_name: 'Review Workflow App',
  type: 'evaluation',
  version: '1',
  marked_name: 'Review Workflow',
  marked_comment: 'Production release',
  hash: 'hash-1',
  created_by: {
    id: 'user-1',
    name: 'User One',
    email: 'user-one@example.com',
  },
  created_at: 1710000000,
  updated_by: null,
  updated_at: 1710000000,
  ...overrides,
})

const setupWorkflowQueryMock = (overrides?: {
  workflows?: AvailableEvaluationWorkflow[]
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
}) => {
  const fetchNextPage = vi.fn()

  mockUseAvailableEvaluationWorkflows.mockReturnValue({
    data: {
      pages: [{
        items: overrides?.workflows ?? [createWorkflow()],
        page: 1,
        limit: 20,
        has_more: overrides?.hasNextPage ?? false,
      }],
    },
    fetchNextPage,
    hasNextPage: overrides?.hasNextPage ?? false,
    isFetching: false,
    isFetchingNextPage: overrides?.isFetchingNextPage ?? false,
    isLoading: false,
  })

  return { fetchNextPage }
}

const renderWorkflowSelector = (props?: Partial<ComponentProps<typeof WorkflowSelector>>) => {
  return render(
    <WorkflowSelector
      value={null}
      onSelect={vi.fn()}
      {...props}
    />,
  )
}

describe('WorkflowSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadMoreHandler = null

    setupWorkflowQueryMock()
    mockUseInfiniteScroll.mockImplementation((handler) => {
      loadMoreHandler = handler as () => Promise<{ list: unknown[] }>
    })
  })

  // Cover trigger rendering and selected label fallback.
  describe('Rendering', () => {
    it('should render the workflow placeholder when value is empty', () => {
      renderWorkflowSelector()

      expect(screen.getByRole('button', { name: 'evaluation.metrics.custom.workflowLabel' })).toBeInTheDocument()
      expect(screen.getByText('evaluation.metrics.custom.workflowPlaceholder')).toBeInTheDocument()
    })

    it('should render the selected workflow name from props when value is set', () => {
      setupWorkflowQueryMock({ workflows: [] })

      renderWorkflowSelector({
        value: 'app-1',
        selectedWorkflowName: 'Saved Review Workflow',
      })

      expect(screen.getByText('Saved Review Workflow')).toBeInTheDocument()
    })

    it('should resolve the selected workflow from app id', () => {
      setupWorkflowQueryMock()

      renderWorkflowSelector({
        value: 'app-1',
      })

      expect(screen.getByText('Review Workflow')).toBeInTheDocument()
    })
  })

  // Cover opening the popover and choosing one workflow option.
  describe('Interactions', () => {
    it('should call onSelect with the clicked workflow', async () => {
      const onSelect = vi.fn()

      renderWorkflowSelector({ onSelect })

      fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.custom.workflowLabel' }))

      const option = await screen.findByRole('option', { name: 'Review Workflow' })
      fireEvent.click(option)

      expect(onSelect).toHaveBeenCalledWith(createWorkflow())
    })

    it('should mark the option selected when its app id matches the value', async () => {
      renderWorkflowSelector({ value: 'app-1' })

      fireEvent.click(screen.getByRole('button', { name: 'evaluation.metrics.custom.workflowLabel' }))

      expect(await screen.findByRole('option', { name: 'Review Workflow', selected: true })).toBeInTheDocument()
    })
  })

  // Cover the infinite-scroll callback used by the ScrollArea viewport.
  describe('Pagination', () => {
    it('should fetch the next page when the load-more callback runs and more pages exist', async () => {
      const { fetchNextPage } = setupWorkflowQueryMock({ hasNextPage: true })

      renderWorkflowSelector()

      await waitFor(() => expect(loadMoreHandler).not.toBeNull())

      await act(async () => {
        await loadMoreHandler?.()
      })

      expect(fetchNextPage).toHaveBeenCalledTimes(1)
    })

    it('should not fetch the next page when the current request is already fetching', async () => {
      const { fetchNextPage } = setupWorkflowQueryMock({
        hasNextPage: true,
        isFetchingNextPage: true,
      })

      renderWorkflowSelector()

      await waitFor(() => expect(loadMoreHandler).not.toBeNull())

      await act(async () => {
        await loadMoreHandler?.()
      })

      expect(fetchNextPage).not.toHaveBeenCalled()
    })
  })
})
