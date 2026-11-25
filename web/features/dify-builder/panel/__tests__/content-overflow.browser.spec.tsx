import type { ConversationItem, SessionView } from '../../types'
import { QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createDeferred } from '@/test/deferred'
import { createDifyBuilderRuntime, createNativeApproval } from '@/test/fixtures/dify-builder'
import DifyBuilderPanel from '..'
import { createBuilderQueryClient } from '../../__tests__/model-fixtures'
import {
  difyBuilderConversationAtom,
  difyBuilderSessionViewAtom,
  difyBuilderTaskControlAtom,
} from '../../session/state'
import { difyBuilderCanvasAppliedViewAtom, difyBuilderRuntimeAtom } from '../../state'

// boundary: the panel's close action writes to the workflow app store, which needs the full canvas host.
vi.mock('@/app/components/workflow-app/store/workflow', () => ({
  useWorkflowAppSelector: <T,>(
    selector: (state: { setShowDifyBuilderPanel: (show: boolean) => void }) => T,
  ) => selector({ setShowDifyBuilderPanel: vi.fn() }),
}))

const cancelTest = {
  id: 'cancel_test',
  kind: 'destructive',
  label: 'Cancel test',
  payload: { request_id: 'request-1' },
} as const
const nativeExecution = {
  evidence_refs: [],
  generation: 0,
  native_run_id: 'run-1',
  native_status: 'running',
  outcome: null,
  pending: [],
  request_id: 'request-1',
  status: 'running',
  version: 1,
  wait_reason: null,
} satisfies NonNullable<SessionView['test_execution']>

const renderPanel = async (
  items: ConversationItem[],
  view: Partial<SessionView> = {},
  viewportHeight = 900,
  runtime = createDifyBuilderRuntime(),
) => {
  await page.viewport(420, viewportHeight)
  const store = createStore()
  const queryClient = createBuilderQueryClient()
  store.set(queryClientAtom, queryClient)
  store.set(difyBuilderRuntimeAtom, runtime)
  store.set(difyBuilderConversationAtom, items)
  store.set(difyBuilderSessionViewAtom, {
    session_id: 'session-1',
    version: 3,
    phase: 'plan',
    run_status: 'waiting_input',
    canvas_read_only: false,
    interrupted: false,
    reply_language: '',
    conversation_last_seq: items.at(-1)?.seq ?? 0,
    active_interaction: null,
    ...view,
  })
  const session = store.get(difyBuilderSessionViewAtom)!
  store.set(difyBuilderCanvasAppliedViewAtom, {
    sessionId: session.session_id,
    version: session.version,
  })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <div className="isolate" style={{ height: Math.min(800, viewportHeight) }}>
          <DifyBuilderPanel />
        </div>
      </Provider>
    </QueryClientProvider>,
  )
  return { screen, store }
}

it('keeps native approval choices and submit in view while long details scroll', async () => {
  const title = 'Test operation approval'
  const risk = 'The operation reads one test message.'
  const pending = createNativeApproval({ risk_notice: `${risk} `.repeat(12).trim() })
  const payload = {
    request_id: 'request-1',
    pending_operation_id: pending.pending_operation_id,
    pending_version: pending.version,
    scope_digest: pending.scope_digest,
  }
  const finishApproval = createDeferred<boolean>()
  const runAction = vi.fn(() => finishApproval.promise)
  const approve = { id: 'confirm_test_operation', label: 'Allow once' }
  const options = [
    approve,
    { id: 'deny_test_operation', label: 'Reject' },
    { id: 'cancel_test', label: 'Cancel test' },
  ]
  const { screen } = await renderPanel(
    [
      {
        seq: 1,
        at_version: 3,
        kind: 'assistant_turn',
        payload: {
          turn_id: 'native-wait',
          execution: {
            status: 'stopped',
            activities: [
              {
                id: 'edit-run-test',
                kind: 'stage',
                label: 'Run affected workflow paths',
                state: 'stopped',
              },
              {
                id: 'node:start',
                kind: 'node',
                parent_id: 'edit-run-test',
                label: 'Start',
                state: 'done',
              },
            ],
          },
        },
      },
    ],
    {
      actions: [{ ...approve, kind: 'primary', payload }, cancelTest],
      phase: 'test',
      run_status: 'waiting_confirmation',
      test_execution: {
        ...nativeExecution,
        native_status: 'paused',
        status: 'waiting',
        wait_reason: 'approval',
        pending: [pending],
      },
      decision: {
        title,
        description: 'The test resumes automatically after approval.',
        options,
        submit: { id: 'confirm', label: 'Submit', kind: 'primary' },
      },
    },
    480,
    createDifyBuilderRuntime({ session: { runAction } }),
  )
  const dock = screen.getByRole('region', { name: title })
  const submit = dock.getByRole('button', { name: 'Submit' })
  const stop = screen.getByRole('button', { name: 'difyBuilder.taskControl.stop' })
  await expect.element(submit).toBeDisabled()
  await expect.element(stop).not.toBeInTheDocument()
  const run = screen.getByRole('article', { name: 'difyBuilder.cardCategory.test' })
  await expect.element(screen.getByText('Run affected workflow paths')).toBeVisible()
  await expect
    .element(run.getByRole('status'))
    .toHaveTextContent('difyBuilder.nativeTest.waitingForApproval')
  await expect
    .element(screen.getByRole('button', { name: cancelTest.label }))
    .not.toBeInTheDocument()
  await expect.element(dock.getByRole('radio', { name: cancelTest.label })).not.toBeInTheDocument()
  for (const control of [
    dock.getByRole('radio', { name: 'Allow once' }),
    dock.getByRole('radio', { name: 'Reject' }),
    submit,
  ]) {
    await expect.element(control).toBeVisible()
    await expect
      .poll(() => {
        const element = control.element()
        const bounds = element.getBoundingClientRect()
        return element.contains(
          element.ownerDocument.elementFromPoint(bounds.x + bounds.width / 2, bounds.bottom - 1),
        )
      })
      .toBe(true)
  }

  const details = dock.getByRole('region', { name: 'common.operation.viewDetails' })
  await expect.element(details).toBeVisible()
  await expect.element(details.getByText('Read one message')).toBeInTheDocument()
  await expect.element(details.getByText('Synthetic message')).toBeInTheDocument()
  await expect.element(details.getByText(pending.risk_notice!)).toBeInTheDocument()
  const viewport = details.element()
  expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)
  const submitTop = submit.element().getBoundingClientRect().top

  await details.click()
  await userEvent.keyboard('{End}')
  await expect
    .poll(() => viewport.scrollTop + viewport.clientHeight)
    .toBeGreaterThanOrEqual(viewport.scrollHeight - 1)
  expect(submit.element().getBoundingClientRect().top).toBe(submitTop)
  await details.getByText('difyBuilder.nativeTest.parameters').click()
  await expect.element(details.getByText('limit')).toBeVisible()
  await dock.getByRole('radio', { name: 'Allow once' }).click()
  await dock.getByRole('button', { name: 'Allow once' }).click()
  const transcript = screen.getByRole('log', { name: 'difyBuilder.panelTitle' })
  await expect.element(transcript.getByRole('heading', { name: title })).toBeVisible()
  await expect.element(transcript.getByText('Allow once')).toBeVisible()
  await expect.element(transcript.getByText(pending.risk_notice!)).not.toBeInTheDocument()
  expect(runAction).toHaveBeenCalledExactlyOnceWith(
    'confirm',
    { option_id: 'confirm_test_operation', ...payload },
    expect.objectContaining({ interaction_kind: 'choice', question: title, answer: 'Allow once' }),
  )
  finishApproval.resolve(true)
})

it('uses Stop for the running native test and offers Resume after it settles', async () => {
  const finishStopping = createDeferred<void>()
  const stopTask = vi.fn<() => Promise<boolean>>()
  const resumeTask = vi.fn(async () => true)
  const runAction = vi.fn(async () => true)
  const { screen, store } = await renderPanel(
    [],
    {
      actions: [cancelTest],
      canvas_read_only: true,
      phase: 'test',
      run_status: 'processing',
      test_execution: nativeExecution,
    },
    480,
    createDifyBuilderRuntime({ session: { stopTask, resumeTask, runAction } }),
  )
  stopTask.mockImplementation(async () => {
    store.set(difyBuilderTaskControlAtom, { operation: 'stop', phase: 'pending' })
    await finishStopping.promise
    const current = store.get(difyBuilderSessionViewAtom)!
    const version = current.version + 1
    store.set(difyBuilderSessionViewAtom, {
      ...current,
      actions: [],
      canvas_read_only: false,
      run_status: 'paused',
      task_status: 'paused',
      test_execution: {
        ...nativeExecution,
        native_status: 'stopped',
        outcome: 'cancelled',
        status: 'terminal',
        version: nativeExecution.version + 1,
      },
      version,
    })
    store.set(difyBuilderCanvasAppliedViewAtom, { sessionId: current.session_id, version })
    store.set(difyBuilderTaskControlAtom, null)
    return true
  })

  const stop = screen.getByRole('button', { name: 'difyBuilder.taskControl.stop' })
  const resume = screen.getByRole('button', { name: 'difyBuilder.taskControl.resume' })
  await expect
    .element(
      screen.getByRole('article', { name: 'difyBuilder.cardCategory.test' }).getByRole('status'),
    )
    .toHaveTextContent('difyBuilder.running')
  await expect
    .element(screen.getByRole('button', { name: cancelTest.label }))
    .not.toBeInTheDocument()
  await stop.click()
  await expect.element(stop).toBeDisabled()
  await expect.element(resume).not.toBeInTheDocument()
  expect(stopTask).toHaveBeenCalledOnce()

  finishStopping.resolve()
  await expect.element(resume).toBeEnabled()
  await resume.click()
  expect(resumeTask).toHaveBeenCalledOnce()
  expect(runAction).not.toHaveBeenCalled()
})
