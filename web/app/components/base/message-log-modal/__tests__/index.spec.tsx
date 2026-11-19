import type { WorkflowRunDetailResponse } from '@/models/log'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import MessageLogModal from '../index'

const { fetchRunDetail, fetchTracingList } = vi.hoisted(() => ({
  fetchRunDetail: vi.fn(),
  fetchTracingList: vi.fn(),
}))
vi.mock('@/service/log', () => ({ fetchRunDetail, fetchTracingList }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.traceRuns.bySourceKind.bySourceId.get': () => ({ status: 'not_collected' }),
    }),
  }
})
beforeEach(() => {
  fetchRunDetail.mockImplementation(async (url: string): Promise<WorkflowRunDetailResponse> => {
    if (
      url !== '/apps/inspected-app/workflow-runs/run-1' &&
      url !== '/apps/app-1/workflow-runs/run-1'
    )
      throw new Error(`Unexpected detail: ${url}`)
    return {
      id: 'run-1',
      version: '1',
      graph: { nodes: [], edges: [] },
      inputs: '{}',
      inputs_truncated: false,
      outputs: 'message output',
      outputs_truncated: false,
      status: 'succeeded',
      elapsed_time: 1,
      total_tokens: 3,
      total_steps: 1,
      created_by_role: 'account',
      created_by_account: { id: 'user', name: 'Alice', email: 'alice@example.com' },
      created_at: 1710000000,
      finished_at: 1710000001,
    }
  })
  fetchTracingList.mockImplementation(async ({ url }: { url: string }) => {
    if (
      url !== '/apps/inspected-app/workflow-runs/run-1/node-executions' &&
      url !== '/apps/app-1/workflow-runs/run-1/node-executions'
    )
      throw new Error(`Unexpected tracing: ${url}`)
    return { data: [createNodeTracing({ title: 'Message execution' })] }
  })
})
const log = { id: 'message-1', content: 'Message', isAnswer: true, workflow_run_id: 'run-1' }

it.each([undefined, { ...log, workflow_run_id: undefined }])(
  'omits the viewer without a workflow run: %j',
  (currentLogItem) => {
    const { container } = render(
      <MessageLogModal
        appId="app-1"
        width={800}
        onCancel={vi.fn()}
        currentLogItem={currentLogItem}
      />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(fetchRunDetail).not.toHaveBeenCalled()
    expect(fetchTracingList).not.toHaveBeenCalled()
  },
)

it.each([false, true])(
  'selects the message run and closes its viewer (fixed=%s)',
  async (fixedWidth) => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    function Viewer() {
      const [open, setOpen] = useState(true)
      return (
        open && (
          <MessageLogModal
            appId="inspected-app"
            width={800}
            onCancel={() => {
              onCancel()
              setOpen(false)
            }}
            currentLogItem={log}
            defaultTab="TRACING"
            fixedWidth={fixedWidth}
          />
        )
      )
    }
    render(<Viewer />)
    expect(screen.getByRole('tab', { name: 'runLog.tracing' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.queryByRole('tab', { name: 'runLog.result' })).not.toBeInTheDocument()
    expect(await screen.findByText('Message execution')).toBeInTheDocument()
    expect(fetchRunDetail).toHaveBeenCalledWith('/apps/inspected-app/workflow-runs/run-1', {
      silent: true,
    })
    expect(fetchTracingList).toHaveBeenCalledWith(
      { url: '/apps/inspected-app/workflow-runs/run-1/node-executions' },
      { silent: true },
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Message execution')).not.toBeInTheDocument()
  },
)

it('dismisses the fixed viewer on an outside click but not an inside click', async () => {
  const user = userEvent.setup()
  const onCancel = vi.fn()
  render(
    <>
      <button type="button">Outside viewer</button>
      <MessageLogModal
        appId="app-1"
        width={800}
        onCancel={onCancel}
        currentLogItem={log}
        fixedWidth
      />
    </>,
  )
  await user.click(screen.getByRole('heading', { name: 'appLog.runDetail.title' }))
  expect(onCancel).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Outside viewer' }))
  expect(onCancel).toHaveBeenCalledTimes(1)
})
