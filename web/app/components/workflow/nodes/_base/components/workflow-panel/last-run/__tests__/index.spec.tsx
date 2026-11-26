import type { ComponentProps } from 'react'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { createErrorToastCaches } from '@/app/query-error-toast'
import { createHttpError } from '@/service/http-error'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedAppDslVersion, seedSystemFeatures } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import LastRun from '../index'

const lastRun = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.nodes.byNodeId.lastRun.get': lastRun,
    }),
  }
})

const result = createNodeTracing({
  outputs: { answer: 'Saved answer' },
  execution_metadata: { total_tokens: 9, total_price: 0, currency: 'USD' },
})
const props = {
  nodeId: 'node-1',
  canSingleRun: true,
  isRunAfterSingleRun: true,
  updateNodeRunningStatus: vi.fn(),
  onSingleRunClicked: vi.fn(),
}
const setup = (overrides: Partial<ComponentProps<typeof LastRun>> = {}) =>
  render(<LastRun {...props} {...overrides} />, {
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
  })
let visibilityState = 'visible'
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
beforeEach(() => {
  lastRun.mockResolvedValue(result)
  visibilityState = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityState,
  })
})
afterEach(() => {
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility)
  else Reflect.deleteProperty(document, 'visibilityState')
})
const changeVisibility = (value: string) =>
  act(() => {
    visibilityState = value
    document.dispatchEvent(new Event('visibilitychange'))
  })

it('waits for the selected node last run before showing its saved output', async () => {
  const pending = createDeferred<typeof result>()
  lastRun.mockReturnValue(pending.promise)
  setup({ isRunAfterSingleRun: false })
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await act(async () => pending.resolve(result))
  expect(await screen.findByDisplayValue(/Saved answer/)).toHaveAttribute('readonly')
  expect(lastRun).toHaveBeenCalledWith({ params: { app_id: 'app-1', node_id: 'node-1' } })
})

it('shows the actual running status before the single run completes', () => {
  setup({ runningStatus: NodeRunningStatus.Running })
  expect(screen.getByRole('status')).toHaveTextContent('appLog.status.running')
  expect(lastRun).not.toHaveBeenCalled()
})

const setupWithErrorToasts = () => {
  const errorToast = vi.spyOn(toast, 'error')
  const queryClient = createTestQueryClient(undefined, { caches: createErrorToastCaches() })
  seedSystemFeatures(queryClient)
  seedAppDslVersion(queryClient)
  seedAccountProfileQuery(queryClient)
  render(<LastRun {...props} isRunAfterSingleRun={false} />, {
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    queryClient,
  })
  return { errorToast }
}

it('offers single run for a missing last run without reporting an error', async () => {
  lastRun.mockRejectedValue(createHttpError(new Response(null, { status: 404 })))
  const user = userEvent.setup()
  const { errorToast } = setupWithErrorToasts()
  await user.click(
    await screen.findByRole('button', { name: 'workflowDebug.debug.noData.runThisNode' }),
  )
  expect(props.onSingleRunClicked).toHaveBeenCalledOnce()
  expect(errorToast).not.toHaveBeenCalled()
})

it('reports a last run that fails to load', async () => {
  lastRun.mockRejectedValue(
    createHttpError(
      { status: 500, statusText: '', headers: new Headers() },
      { message: 'Run history unavailable' },
    ),
  )
  const { errorToast } = setupWithErrorToasts()
  await vi.waitFor(() =>
    expect(errorToast).toHaveBeenCalledExactlyOnceWith('Run history unavailable'),
  )
})

it('shows saved execution data while paused overrides its completed status', async () => {
  setup({ runningStatus: NodeRunningStatus.Succeeded, isPaused: true })
  expect(await screen.findByDisplayValue(/Saved answer/)).toHaveAttribute('readonly')
  expect(screen.getByRole('status')).toHaveTextContent('appLog.status.stopped')
  expect(screen.getByRole('status')).toHaveTextContent('9 Tokens')
})

it('respects a stopped single-run status', () => {
  setup({ runningStatus: NodeRunningStatus.Stopped })
  expect(screen.getByRole('status')).toHaveTextContent('appLog.status.stopped')
})

it('restores a completed status after hiding the page loses transient canvas state', async () => {
  function Scenario({ status }: { status: NodeRunningStatus }) {
    const [restoredStatus, setRestoredStatus] = useState<NodeRunningStatus>()
    return (
      <>
        <output aria-label="Restored node status">{restoredStatus}</output>
        <LastRun {...props} runningStatus={status} updateNodeRunningStatus={setRestoredStatus} />
      </>
    )
  }
  const { rerender } = render(<Scenario status={NodeRunningStatus.Running} />, {
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
  })
  rerender(<Scenario status={NodeRunningStatus.Succeeded} />)
  expect(await screen.findByDisplayValue(/Saved answer/)).toBeInTheDocument()
  changeVisibility('hidden')
  rerender(<Scenario status={NodeRunningStatus.NotStart} />)
  expect(screen.getByRole('status', { name: 'Restored node status' })).toBeEmptyDOMElement()
  changeVisibility('visible')
  expect(screen.getByRole('status', { name: 'Restored node status' })).toHaveTextContent(
    'succeeded',
  )
  expect(screen.getByDisplayValue(/Saved answer/)).toBeInTheDocument()
})
