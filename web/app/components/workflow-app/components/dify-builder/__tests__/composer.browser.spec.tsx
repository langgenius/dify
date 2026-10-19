import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import DifyBuilderComposer from '../composer'
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
