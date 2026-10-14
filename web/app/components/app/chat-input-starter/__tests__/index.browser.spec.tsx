import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { promptDefaultModel, promptModelProviders } from '../../__tests__/prompt-model-fixtures'
import ChatInputStarter from '../index'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: app } = await import('@/i18n/locales/en-US/app.json')
  const { default: workflow } = await import('@/i18n/locales/en-US/workflow.json')
  const { default: builder } = await import('@/i18n/locales/en-US/dify-builder.json')
  const { default: common } = await import('@/i18n/locales/en-US/common.json')
  return createReactI18nextMock({
    ...app,
    ...workflow,
    ...common,
    ...Object.fromEntries(
      Object.entries(builder).map(([key, value]) => [`difyBuilder.${key}`, value]),
    ),
  })
})

const longPrompt = Array.from(
  { length: 17 },
  (_, index) => `Step ${index + 1}: process a receipt.`,
).join('\n')

describe('Builder prompt input', () => {
  afterEach(() => vi.restoreAllMocks())

  it('grows with a long prompt, caps scrolling above the actions, and resizes AI results at narrow widths', async () => {
    // The unit environment cannot reveal clipped prompts or actions scrolling out of reach.
    // Render the production starter and its real model improvement hook to cover both paths.
    await page.viewport(1000, 900)
    const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper()
    queryClient.setQueryData(
      consoleQuery.workspaces.current.defaultModel.get.queryOptions({
        input: { query: { model_type: 'llm' } },
      }).queryKey,
      { data: promptDefaultModel },
    )
    queryClient.setQueryData(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
        input: { params: { model_type: 'llm' } },
      }).queryKey,
      { data: promptModelProviders },
    )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      if (new URL(request.url).pathname.endsWith('/workflow-generate/improve'))
        return Response.json({ instruction: longPrompt, changed: true })
      throw new Error(`Unexpected request: ${request.url}`)
    })
    const onCreate = vi.fn()
    const screen = await render(
      <Wrapper>
        <ChatInputStarter
          show
          mode="workflow"
          onClose={vi.fn()}
          onCreate={onCreate}
          isCreating={false}
          disabled={false}
          isAppsFull={false}
          error=""
        />
      </Wrapper>,
    )
    const input = screen.getByRole('textbox', { name: 'Build your next workflow' })
    const send = screen.getByRole('button', { name: 'Send', exact: true })
    const optimize = screen.getByRole('button', { name: 'Optimize with AI' })
    await expect.element(input).toBeVisible()
    const inputElement = input.element() as HTMLTextAreaElement
    const initialHeight = inputElement.getBoundingClientRect().height
    expect(initialHeight).toBe(104)

    await input.fill('First\nSecond\nThird\nFourth')
    expect(inputElement.getBoundingClientRect().height).toBe(initialHeight)
    await input.fill('First\nSecond\nThird\nFourth\nFifth')
    expect(inputElement.getBoundingClientRect().height).toBe(initialHeight + 20)

    await input.fill(longPrompt)
    expect(inputElement.getBoundingClientRect().height).toBe(344)
    expect(inputElement.scrollHeight).toBeGreaterThan(inputElement.clientHeight)
    const sendTop = send.element().getBoundingClientRect().top
    inputElement.scrollTop = inputElement.scrollHeight
    expect(inputElement.scrollTop).toBeGreaterThan(0)
    expect(send.element().getBoundingClientRect().top).toBe(sendTop)
    expect(send.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
      inputElement.getBoundingClientRect().bottom,
    )

    await input.fill('Read receipts')
    expect(inputElement.getBoundingClientRect().height).toBe(initialHeight)
    await optimize.click()
    await expect.element(input).toHaveValue(longPrompt)
    expect(inputElement.getBoundingClientRect().height).toBe(344)

    await page.viewport(320, 900)
    await expect.element(input).toBeVisible()
    for (const control of [input, optimize, send]) {
      const bounds = control.element().getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(320)
    }
    expect(inputElement.getBoundingClientRect().height).toBe(344)
    await send.click()
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(longPrompt)
    queryClient.clear()
  })
})
