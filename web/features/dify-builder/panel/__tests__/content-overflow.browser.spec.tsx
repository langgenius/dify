import type { ConversationItem, SessionView } from '../../types'
import { QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createDeferred } from '@/test/deferred'
import { createDifyBuilderRuntime } from '@/test/fixtures/dify-builder'
import DifyBuilderPanel from '..'
import { createBuilderQueryClient } from '../../__tests__/model-fixtures'
import {
  difyBuilderConversationAtom,
  difyBuilderSessionViewAtom,
  difyBuilderTaskControlAtom,
} from '../../session/state'
import { difyBuilderCanvasAppliedViewAtom, difyBuilderRuntimeAtom } from '../../state'

vi.mock('@/app/components/workflow-app/store/workflow', () => ({
  useWorkflowAppSelector: <T,>(
    selector: (state: { setShowDifyBuilderPanel: (show: boolean) => void }) => T,
  ) => selector({ setShowDifyBuilderPanel: vi.fn() }),
}))

const model = 'model:langgenius/tokener/tokener/deepseek-v4.1-flash'
const endpoint = `https://models.example.com/deployments/${'deepseek-v4.1-flash-'.repeat(4)}`
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

const expectContained = (element: Element, container: Element) => {
  const bounds = container.getBoundingClientRect()
  const content = element.getBoundingClientRect()
  expect(content.left).toBeGreaterThanOrEqual(bounds.left)
  expect(content.right).toBeLessThanOrEqual(bounds.right)
}

const expectTextContained = (element: Element, container: Element) => {
  const range = document.createRange()
  range.selectNodeContents(element)
  const bounds = container.getBoundingClientRect()
  for (const line of range.getClientRects()) {
    expect(line.left).toBeGreaterThanOrEqual(bounds.left)
    expect(line.right).toBeLessThanOrEqual(bounds.right)
    expect(line.top).toBeGreaterThanOrEqual(bounds.top)
    expect(line.bottom).toBeLessThanOrEqual(bounds.bottom)
  }
}

const expectNoHorizontalScrolling = (panel: Element) => {
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth)
}

it('keeps truncated model selections and long inputs inside both the active form and its submitted receipt', async () => {
  const fields = [
    { key: 'model', label: 'Model', type: 'select', options: [model], default: model },
    { key: 'endpoint', label: 'Endpoint', type: 'text', default: endpoint },
    { key: 'notes', label: 'Notes', type: 'textarea', default: endpoint },
  ]
  const { screen } = await renderPanel(
    [
      { seq: 1, at_version: 1, kind: 'form', payload: { variant: 'edit_rules', fields } },
      {
        seq: 2,
        at_version: 2,
        kind: 'interaction_response',
        payload: {
          interaction_kind: 'form',
          question: 'Submitted changes',
          fields: [
            { key: 'model', label: 'Model', value: model, display_value: model },
            { key: 'endpoint', label: 'Endpoint', value: endpoint, display_value: endpoint },
            { key: 'notes', label: 'Notes', value: endpoint, display_value: endpoint },
          ],
          submitted_data: { model, endpoint, notes: endpoint },
        },
      },
      {
        seq: 3,
        at_version: 3,
        kind: 'form',
        payload: { variant: 'edit_rules', title: 'Review changes', fields },
      },
    ],
    { active_interaction: { action_id: 'submit_edit_rules', card_seq: 3, valid_at_version: 3 } },
  )
  const dock = screen.getByRole('region', { name: 'Review changes' })
  const transcript = screen.getByRole('log', { name: 'difyBuilder.panelTitle' })
  await expect.element(dock.getByRole('combobox', { name: 'Model' })).toBeVisible()
  await expect.element(transcript.getByRole('combobox', { name: 'Model' })).toBeVisible()

  for (const surface of [dock, transcript]) {
    const select = surface.getByRole('combobox', { name: 'Model' })
    const input = surface.getByRole('textbox', { name: 'Endpoint' })
    const notes = surface.getByRole('textbox', { name: 'Notes' })
    await expect.element(input).toHaveValue(endpoint)
    await expect.element(notes).toHaveValue(endpoint)
    expect(select.element().textContent).toContain(model)
    expectContained(select.element(), surface.element())
    expectContained(input.element(), surface.element())
    expectContained(notes.element(), surface.element())
    expect(notes.element().scrollWidth).toBeLessThanOrEqual(notes.element().clientWidth)
    expect(surface.element().scrollWidth).toBeLessThanOrEqual(surface.element().clientWidth)
  }

  await dock.getByRole('combobox', { name: 'Model' }).click()
  const option = page.getByRole('option', { name: model })
  await expect.element(option).toBeVisible()
  expectTextContained(option.element(), option.element())
  await option.click()
  expectNoHorizontalScrolling(
    screen.getByRole('complementary', { name: 'difyBuilder.panelTitle' }).element(),
  )
})

it('keeps native approval choices and submit in view while long details scroll', async () => {
  const title = 'How should Builder continue?'
  const detail =
    'The command downloads the configured skill into the workspace and reads the script help.'
  const description = `Review the proposed Shell call. ${Array.from({ length: 12 }, () => detail).join(' ')}`
  const options = [
    { id: 'confirm_test_operation', label: 'Allow once' },
    { id: 'deny_test_operation', label: 'Reject' },
    { id: 'cancel_test', label: 'Cancel test' },
  ]
  const { screen } = await renderPanel(
    [],
    {
      actions: [cancelTest],
      phase: 'test',
      run_status: 'waiting_confirmation',
      test_execution: {
        ...nativeExecution,
        native_status: 'paused',
        status: 'waiting',
        wait_reason: 'approval',
      },
      decision: {
        title,
        description,
        options,
        submit: { id: 'confirm', label: 'Submit', kind: 'primary' },
      },
    },
    480,
  )
  const dock = screen.getByRole('region', { name: title })
  const submit = dock.getByRole('button', { name: 'Submit' })
  const stop = screen.getByRole('button', { name: 'difyBuilder.taskControl.stop' })
  await expect.element(submit).toBeDisabled()
  await expect.element(stop).toBeEnabled()
  await expect
    .element(screen.getByRole('button', { name: cancelTest.label }))
    .not.toBeInTheDocument()
  await expect.element(dock.getByRole('radio', { name: cancelTest.label })).not.toBeInTheDocument()
  for (const control of [
    dock.getByRole('radio', { name: 'Allow once' }),
    dock.getByRole('radio', { name: 'Reject' }),
    submit,
    stop,
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
  const viewport = details.element()
  expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)
  const submitTop = submit.element().getBoundingClientRect().top

  await details.click()
  await userEvent.keyboard('{End}')
  await expect
    .poll(() => viewport.scrollTop + viewport.clientHeight)
    .toBeGreaterThanOrEqual(viewport.scrollHeight - 1)
  expect(submit.element().getBoundingClientRect().top).toBe(submitTop)
  await dock.getByRole('radio', { name: 'Allow once' }).click()
  await expect.element(dock.getByRole('button', { name: 'Allow once' })).toBeEnabled()
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

it('keeps long user text and expanded execution labels readable within the conversation', async () => {
  const userText = 'deepseekv41flash'.repeat(12)
  const activity = `Inspect ${model}`
  const { screen } = await renderPanel([
    { seq: 1, at_version: 1, kind: 'user', payload: { text: userText, turn_id: 'user-1' } },
    {
      seq: 2,
      at_version: 2,
      kind: 'assistant_turn',
      payload: {
        turn_id: 'reply-1',
        execution: {
          status: 'completed',
          activities: [{ id: 'inspect', label: activity, state: 'done' }],
        },
        reply_text: `Available model: ${endpoint}`,
      },
    },
  ])
  const transcript = screen.getByRole('log', { name: 'difyBuilder.panelTitle' })
  const message = transcript.getByText(userText)
  await expect.element(message).toBeVisible()
  expectTextContained(message.element(), transcript.element())
  const reply = transcript.getByText(`Available model: ${endpoint}`)
  await expect.element(reply).toBeVisible()
  expectTextContained(reply.element(), transcript.element())
  await transcript.getByText(activity).click()
  const labels = transcript.getByText(activity)
  await expect.element(labels.nth(1)).toBeVisible()
  for (const label of labels.elements()) expectTextContained(label, transcript.element())
  expectNoHorizontalScrolling(
    screen.getByRole('complementary', { name: 'difyBuilder.panelTitle' }).element(),
  )
})
