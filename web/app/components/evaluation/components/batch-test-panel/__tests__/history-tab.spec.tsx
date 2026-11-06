import type {
  EvaluationRunDetailResponse,
  EvaluationRunResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { useEvaluationStore } from '../../../store'
import HistoryTab from '../history-tab'

const resourceId = 'dataset-1'

const createRun = (
  id: string,
  createdAt: number,
  targetType = 'dataset',
  targetId = resourceId,
): EvaluationRunResponse => ({
  completed_items: 1,
  created_at: createdAt,
  created_by: 'user-1',
  evaluation_config_id: 'config-1',
  failed_items: 0,
  id,
  progress: 100,
  status: 'completed',
  target_id: targetId,
  target_type: targetType,
  tenant_id: 'tenant-1',
  total_items: 1,
})

const createDetail = (run: EvaluationRunResponse, query: string): EvaluationRunDetailResponse => ({
  run,
  items: {
    data: [
      {
        id: `${run.id}-item`,
        item_index: 0,
        inputs: { query },
        expected_output: `${query} expected`,
        actual_output: `${query} answer`,
        metrics: [{ name: 'accuracy', value: 0.9 }],
        overall_score: 1,
      },
    ],
    page: 1,
    page_size: 100,
    total: 1,
  },
})

describe('evaluation history result preview', () => {
  it('opens a result preview for the clicked record', async () => {
    const user = userEvent.setup()
    const queryClient = createConsoleQueryClient()
    const firstRun = createRun('run-1', 1793894400)
    const secondRun = createRun('run-2', 1793808000)
    queryClient.setQueryData(
      consoleQuery.datasets.byDatasetId.evaluation.logs.get.queryKey({
        input: {
          params: { dataset_id: resourceId },
          query: { page: 1, page_size: 16 },
        },
      }),
      { data: [firstRun, secondRun], page: 1, page_size: 16, total: 2 },
    )
    for (const [run, query] of [
      [firstRun, 'first question'],
      [secondRun, 'second question'],
    ] as const) {
      queryClient.setQueryData(
        consoleQuery.datasets.byDatasetId.evaluation.runs.byRunId.get.queryKey({
          input: {
            params: { dataset_id: resourceId, run_id: run.id },
            query: { page: 1, page_size: 100 },
          },
        }),
        createDetail(run, query),
      )
    }
    queryClient.setQueryData(consoleQuery.workspaces.current.members.get.queryKey({ input: {} }), {
      accounts: [],
    })
    act(() => useEvaluationStore.getState().ensureResource('datasets', resourceId))

    renderWithConsoleQuery(<HistoryTab resourceType="datasets" resourceId={resourceId} />, {
      queryClient,
    })

    await user.click(screen.getByRole('row', { name: /2026-11-05/ }))
    const dialog = await screen.findByRole('dialog', { name: 'evaluation.results.title' })
    expect(within(dialog).getByText('first question')).toBeInTheDocument()
    expect(within(dialog).queryByText('second question')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /evaluation.results.title.*2026-11-04/ }))
    const secondDialog = await screen.findByRole('dialog', { name: 'evaluation.results.title' })
    expect(within(secondDialog).getByText('second question')).toBeInTheDocument()
    expect(within(secondDialog).queryByText('first question')).not.toBeInTheDocument()
  })

  it.each([
    ['agents', 'agent'],
    ['apps', 'workflow'],
  ] as const)('opens a result preview from an %s record', async (resourceType, targetType) => {
    const user = userEvent.setup()
    const targetId = `${targetType}-1`
    const run = createRun('run-1', 1793894400, resourceType, targetId)
    const queryClient = createConsoleQueryClient()
    queryClient.setQueryData(
      consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.logs.get.queryKey({
        input: {
          params: { evaluate_target_id: targetId, evaluate_target_type: resourceType },
          query: { page: 1, page_size: 16 },
        },
      }),
      { data: [run], page: 1, page_size: 16, total: 1 },
    )
    queryClient.setQueryData(
      consoleQuery.byEvaluateTargetType.byEvaluateTargetId.evaluation.runs.byRunId.get.queryKey({
        input: {
          params: {
            evaluate_target_id: targetId,
            evaluate_target_type: resourceType,
            run_id: run.id,
          },
          query: { page: 1, page_size: 100 },
        },
      }),
      createDetail(run, `${targetType} question`),
    )
    queryClient.setQueryData(consoleQuery.workspaces.current.members.get.queryKey({ input: {} }), {
      accounts: [],
    })
    act(() => useEvaluationStore.getState().ensureResource(resourceType, targetId))

    renderWithConsoleQuery(<HistoryTab resourceType={resourceType} resourceId={targetId} />, {
      queryClient,
    })

    await user.click(screen.getByRole('row', { name: /2026-11-05/ }))
    const dialog = await screen.findByRole('dialog', { name: 'evaluation.results.title' })
    expect(within(dialog).getByText(`${targetType} question`)).toBeInTheDocument()
    expect(within(dialog).getByText(`${targetType} question answer`)).toBeInTheDocument()
    expect(within(dialog).getByText('0.9')).toBeInTheDocument()
  })
})

describe('evaluation history run status', () => {
  it.each([
    [
      'all items failed',
      { completed_items: 0, failed_items: 3 },
      'evaluation.history.status.failed',
    ],
    [
      'some items failed',
      { completed_items: 2, failed_items: 1 },
      'evaluation.history.status.partiallyFailed',
    ],
    [
      'no items failed',
      { completed_items: 3, failed_items: 0 },
      'evaluation.history.status.completed',
    ],
  ] as const)('labels a completed run when %s', (_, counts, expectedLabel) => {
    const queryClient = createConsoleQueryClient()
    queryClient.setQueryData(
      consoleQuery.datasets.byDatasetId.evaluation.logs.get.queryKey({
        input: {
          params: { dataset_id: resourceId },
          query: { page: 1, page_size: 16 },
        },
      }),
      {
        data: [{ ...createRun('run-1', 1793894400), ...counts, total_items: 3 }],
        page: 1,
        page_size: 16,
        total: 1,
      },
    )
    queryClient.setQueryData(consoleQuery.workspaces.current.members.get.queryKey({ input: {} }), {
      accounts: [],
    })
    act(() => useEvaluationStore.getState().ensureResource('datasets', resourceId))

    renderWithConsoleQuery(<HistoryTab resourceType="datasets" resourceId={resourceId} />, {
      queryClient,
    })

    expect(screen.getByLabelText(expectedLabel)).toBeInTheDocument()
  })
})
