import type {
  GetAppsByAppIdAdvancedChatWorkflowRunsResponse,
  GetAppsByAppIdWorkflowRunsResponse,
  WorkflowRunForListResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { ReactElement } from 'react'
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

type HistoryInput = { params: { app_id: string } }
const fetchHistory = vi.hoisted(() =>
  vi.fn<(input: HistoryInput) => Promise<GetAppsByAppIdWorkflowRunsResponse>>(),
)
const fetchChatHistory = vi.hoisted(() =>
  vi.fn<(input: HistoryInput) => Promise<GetAppsByAppIdAdvancedChatWorkflowRunsResponse>>(),
)
// boundary: run history API responses
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflowRuns.get': fetchHistory,
      'apps.byAppId.advancedChat.workflowRuns.get': fetchChatHistory,
    }),
  }
})

const createHistoryResponse = (
  data: WorkflowRunForListResponse[] = [],
): GetAppsByAppIdWorkflowRunsResponse => ({ data, has_more: false, limit: 10 })

const createHistoryItem = (
  overrides: Partial<WorkflowRunForListResponse> = {},
): WorkflowRunForListResponse => ({
  id: 'run-1',
  version: 'v1',
  status: WorkflowRunningStatus.Succeeded,
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
  fetchHistory.mockReset().mockResolvedValue(createHistoryResponse())
  fetchChatHistory.mockReset().mockResolvedValue(createHistoryResponse())
})

it('fetches only after opening history and clears log modals when closing it', async () => {
  const user = userEvent.setup()
  const clearModals = vi.fn()
  renderHistory(<ViewHistory withText onClearLogAndMessageModal={clearModals} />)
  expect(fetchHistory).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'workflow.common.showRunHistory' }))
  expect(await screen.findByText('workflow.common.notRunning')).toBeVisible()
  expect(fetchHistory).toHaveBeenCalledExactlyOnceWith({ params: { app_id: 'app-1' } })
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(clearModals).toHaveBeenCalledOnce()
  expect(screen.queryByText('workflow.common.runHistory')).not.toBeInTheDocument()
})

it('clears log modals on the icon trigger and displays loading until history arrives', async () => {
  const user = userEvent.setup()
  const clearModals = vi.fn()
  const response = createDeferred<GetAppsByAppIdWorkflowRunsResponse>()
  fetchHistory.mockReturnValueOnce(response.promise)
  renderHistory(<ViewHistory onClearLogAndMessageModal={clearModals} />)
  await user.click(screen.getByRole('button', { name: 'workflow.common.viewRunHistory' }))
  expect(clearModals).toHaveBeenCalledOnce()
  expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeVisible()
  await act(async () => response.resolve(createHistoryResponse([createHistoryItem()])))
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
  fetchHistory.mockResolvedValue(createHistoryResponse([run]))
  const { store } = renderHistory(
    <>
      <ViewHistory withText />
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
    historyWorkflowData: {
      id: 'run-paused',
      status: WorkflowRunningStatus.Paused,
      conversation_id: undefined,
      finished_at: 0,
    },
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
  fetchChatHistory.mockResolvedValue(createHistoryResponse([createHistoryItem()]))
  renderHistory(<ViewHistory withText />, {
    resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
  })
  await user.click(screen.getByRole('button', { name: 'workflow.common.showRunHistory' }))
  expect(await screen.findByText(/^Test Chat \(/)).toBeVisible()
  expect(fetchChatHistory).toHaveBeenCalledExactlyOnceWith({ params: { app_id: 'app-1' } })
  expect(fetchHistory).not.toHaveBeenCalled()
})
