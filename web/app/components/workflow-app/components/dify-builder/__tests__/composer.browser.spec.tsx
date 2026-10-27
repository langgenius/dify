import type { SessionView } from '../types'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDifyBuilderRuntime } from '@/test/fixtures/dify-builder'
import DifyBuilderComposer from '../composer'
import {
  difyBuilderSessionBusyAtom,
  difyBuilderSessionViewAtom,
  difyBuilderTaskControlAtom,
} from '../session/state'
import { difyBuilderCanvasAppliedViewAtom, difyBuilderRuntimeAtom } from '../store'
import { createBuilderQueryClient } from './model-fixtures'

it('expands a long draft, keeps the actions outside its scroll area, and shrinks when cleared', async () => {
  // The fixed-height composer hid all but two lines of a long draft. Browser layout
  // proves the production input grows and scrolls without taking its actions with it.
  await page.viewport(1000, 640)
  const queryClient = createBuilderQueryClient()
  const { wrapper: Wrapper } = createConsoleQueryWrapper({ queryClient })
  const store = createStore()
  store.set(queryClientAtom, queryClient)
  const screen = await render(
    <Wrapper>
      <Provider store={store}>
        <div className="flex h-120 w-100 flex-col justify-end">
          <DifyBuilderComposer />
        </div>
      </Provider>
    </Wrapper>,
  )
  const input = screen.getByRole('textbox', { name: 'difyBuilder.messagePlaceholder' })
  const send = screen.getByRole('button', { name: 'difyBuilder.messageSend' })
  const model = screen.getByRole('button', { name: 'gpt-4.1' })
  await expect.element(input).toBeVisible()
  const inputElement = input.element() as HTMLTextAreaElement
  const initialHeight = inputElement.getBoundingClientRect().height

  try {
    await input.fill('First\nSecond\nThird\nFourth')
    const expandedHeight = inputElement.getBoundingClientRect().height
    expect(expandedHeight).toBeGreaterThan(initialHeight)
    expect(inputElement.scrollHeight).toBe(inputElement.clientHeight)

    const longDraft = Array.from(
      { length: 20 },
      (_, index) => `Step ${index + 1}: process a document.`,
    ).join('\n')
    await input.fill(longDraft)
    const cappedHeight = inputElement.getBoundingClientRect().height
    expect(cappedHeight).toBeGreaterThan(expandedHeight)
    expect(inputElement.scrollHeight).toBeGreaterThan(inputElement.clientHeight)

    const sendTop = send.element().getBoundingClientRect().top
    const modelTop = model.element().getBoundingClientRect().top
    inputElement.scrollTop = inputElement.scrollHeight
    expect(inputElement.scrollTop).toBeGreaterThan(0)
    expect(send.element().getBoundingClientRect().top).toBe(sendTop)
    expect(model.element().getBoundingClientRect().top).toBe(modelTop)
    expect(Math.min(sendTop, modelTop)).toBeGreaterThanOrEqual(
      inputElement.getBoundingClientRect().bottom,
    )
    await expect.element(send).toBeVisible()
    await expect.element(model).toBeVisible()

    // A pasted paragraph wraps without explicit line breaks and respects the same cap.
    await input.fill(longDraft.replaceAll('\n', ' '))
    expect(inputElement.getBoundingClientRect().height).toBe(cappedHeight)
    expect(inputElement.scrollHeight).toBeGreaterThan(inputElement.clientHeight)

    await input.fill('')
    expect(inputElement.getBoundingClientRect().height).toBe(initialHeight)
    await expect.element(send).toBeDisabled()
  } finally {
    queryClient.clear()
  }
})
it('retains native focus through Stop loading and the transition to Resume', async () => {
  // A native-disabled replacement drops focus to the document in Chromium.
  // Exercise the production composer through both pending and settled controls.
  await page.viewport(1000, 640)
  const queryClient = createBuilderQueryClient()
  const { wrapper: Wrapper } = createConsoleQueryWrapper({ queryClient })
  const store = createStore()
  const view: SessionView = {
    session_id: 'session-1',
    version: 1,
    phase: 'test',
    run_status: 'processing',
    canvas_read_only: true,
    interrupted: false,
    reply_language: '',
    conversation_last_seq: -1,
  }
  const stopTask = vi.fn(async () => {
    store.set(difyBuilderTaskControlAtom, { operation: 'stop', phase: 'pending' })
    return true
  })
  store.set(queryClientAtom, queryClient)
  store.set(difyBuilderSessionViewAtom, view)
  store.set(difyBuilderSessionBusyAtom, true)
  store.set(difyBuilderRuntimeAtom, createDifyBuilderRuntime({ session: { stopTask } }))
  const screen = await render(
    <Wrapper>
      <Provider store={store}>
        <div className="flex w-100 flex-col bg-background-body py-4">
          <DifyBuilderComposer />
        </div>
      </Provider>
    </Wrapper>,
  )
  try {
    const stop = screen.getByRole('button', { name: 'difyBuilder.taskControl.stop' })
    await stop.click()
    await expect.element(stop).toHaveAttribute('aria-disabled', 'true')
    await expect.element(stop).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(stopTask).toHaveBeenCalledOnce()

    store.set(difyBuilderSessionViewAtom, {
      ...view,
      version: 2,
      run_status: 'paused',
      canvas_read_only: false,
    })
    store.set(difyBuilderCanvasAppliedViewAtom, { sessionId: view.session_id, version: 2 })
    store.set(difyBuilderSessionBusyAtom, false)
    store.set(difyBuilderTaskControlAtom, null)
    const resume = screen.getByRole('button', { name: 'difyBuilder.taskControl.resume' })
    await expect.element(resume).toBeEnabled()
    await expect.element(resume).toHaveFocus()
  } finally {
    queryClient.clear()
  }
})
