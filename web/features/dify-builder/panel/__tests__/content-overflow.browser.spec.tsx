import type { ConversationItem } from '../../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createDifyBuilderRuntime } from '@/test/fixtures/dify-builder'
import DifyBuilderPanel from '..'
import { difyBuilderConversationAtom, difyBuilderSessionViewAtom } from '../../session/state'
import { difyBuilderRuntimeAtom } from '../../state'

vi.mock('../../composer', () => ({ default: () => null }))
vi.mock('@/app/components/workflow-app/store/workflow', () => ({
  useWorkflowAppSelector: <T,>(
    selector: (state: { setShowDifyBuilderPanel: (show: boolean) => void }) => T,
  ) => selector({ setShowDifyBuilderPanel: vi.fn() }),
}))

const model = 'model:langgenius/tokener/tokener/deepseek-v4.1-flash'
const endpoint = `https://models.example.com/deployments/${'deepseek-v4.1-flash-'.repeat(4)}`

const renderPanel = async (items: ConversationItem[], activeFormSequence?: number) => {
  await page.viewport(420, 900)
  const store = createStore()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  store.set(queryClientAtom, queryClient)
  store.set(difyBuilderRuntimeAtom, createDifyBuilderRuntime())
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
    active_interaction:
      activeFormSequence === undefined
        ? null
        : {
            action_id: 'submit_edit_rules',
            card_seq: activeFormSequence,
            valid_at_version: 3,
          },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <div className="isolate h-200">
          <DifyBuilderPanel />
        </div>
      </Provider>
    </QueryClientProvider>,
  )
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
  const screen = await renderPanel(
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
    3,
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

it('keeps long user text and expanded execution labels readable within the conversation', async () => {
  const userText = 'deepseekv41flash'.repeat(12)
  const activity = `Inspect ${model}`
  const screen = await renderPanel([
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
