import type { ReactElement } from 'react'
import type { WorkflowRunHistory, WorkflowRunHistoryResponse } from '@/types/workflow'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createStartNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { ControlMode, WorkflowRunningStatus } from '../../types'
import ScrollToSelectedNodeButton from '../scroll-to-selected-node-button'
import ViewHistory from '../view-history'

const fetchHistory = vi.hoisted(() => vi.fn<() => Promise<WorkflowRunHistoryResponse>>())
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: fetchHistory,
}))

const createHistoryItem = (overrides: Partial<WorkflowRunHistory> = {}): WorkflowRunHistory => ({
  id: 'run-1',
  version: 'v1',
  graph: {
    nodes: [],
    edges: [],
  },
  inputs: {},
  status: WorkflowRunningStatus.Succeeded,
  outputs: {},
  elapsed_time: 1,
  total_tokens: 2,
  total_steps: 3,
  created_at: 100,
  finished_at: 120,
  created_by_account: {
    id: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
  },
  ...overrides,
})

function renderHistory(
  ui: ReactElement,
  options: Parameters<typeof renderWorkflowFlowComponent>[1] = {},
) {
  const { queryClient } = createConsoleQueryWrapper()
  seedAppDslVersion(queryClient)
  seedModelProviderQueries(queryClient)
  return renderWorkflowFlowComponent(ui, { queryClient, ...options })
}

beforeEach(() => {
  fetchHistory.mockReset().mockResolvedValue({ data: [] })
})

it('fetches only after opening history and clears log modals when closing it', async () => {
  const user = userEvent.setup()
  const clearModals = vi.fn()
  renderHistory(
    <ViewHistory historyUrl="/history" withText onClearLogAndMessageModal={clearModals} />,
  )
  expect(fetchHistory).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'workflow.common.showRunHistory' }))
  expect(await screen.findByText('workflow.common.notRunning')).toBeVisible()
  expect(fetchHistory).toHaveBeenCalledExactlyOnceWith('/history')
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(clearModals).toHaveBeenCalledOnce()
  expect(screen.queryByText('workflow.common.runHistory')).not.toBeInTheDocument()
})

it('clears log modals on the icon trigger and displays loading until history arrives', async () => {
  const user = userEvent.setup()
  const clearModals = vi.fn()
  const response = createDeferred<WorkflowRunHistoryResponse>()
  fetchHistory.mockReturnValueOnce(response.promise)
  renderHistory(<ViewHistory historyUrl="/history" onClearLogAndMessageModal={clearModals} />)
  await user.click(screen.getByRole('button', { name: 'workflow.common.viewRunHistory' }))
  expect(clearModals).toHaveBeenCalledOnce()
  expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
  await act(async () => response.resolve({ data: [createHistoryItem()] }))
  expect(await screen.findByText(/^Test Run \(/)).toBeVisible()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})

it('backs up the draft, clears node selection and editing panels, and selects the historical run', async () => {
  const user = userEvent.setup()
  const backupDraft = vi.fn()
  const run = createHistoryItem({
    id: 'run-paused',
    status: WorkflowRunningStatus.Paused,
    finished_at: 0,
  })
  fetchHistory.mockResolvedValue({ data: [run] })
  const { store } = renderHistory(
    <>
      <ViewHistory historyUrl="/history" withText />
      <ScrollToSelectedNodeButton />
    </>,
    {
      nodes: [createStartNode({ data: { selected: true } })],
      hooksStoreProps: { handleBackupDraft: backupDraft },
      initialStoreState: {
        showInputsPanel: true,
        showEnvPanel: true,
        showDebugAndPreviewPanel: true,
        controlMode: ControlMode.Pointer,
      },
    },
  )
  expect(screen.getByRole('button', { name: 'workflow.panel.scrollToSelectedNode' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'workflow.common.showRunHistory' }))
  await user.click(await screen.findByText('Test Run (Paused)'))
  expect(store.getState()).toMatchObject({
    historyWorkflowData: run,
    showInputsPanel: false,
    showEnvPanel: false,
    showDebugAndPreviewPanel: false,
    controlMode: ControlMode.Hand,
  })
  expect(backupDraft).toHaveBeenCalledOnce()
  expect(
    screen.queryByRole('button', { name: 'workflow.panel.scrollToSelectedNode' }),
  ).not.toBeInTheDocument()
})

it('identifies chatflow history as chat sessions', async () => {
  const user = userEvent.setup()
  fetchHistory.mockResolvedValue({ data: [createHistoryItem()] })
  renderHistory(<ViewHistory historyUrl="/history" withText />, {
    resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
  })
  await user.click(screen.getByRole('button', { name: 'workflow.common.showRunHistory' }))
  expect(await screen.findByText(/^Test Chat \(/)).toBeVisible()
})
