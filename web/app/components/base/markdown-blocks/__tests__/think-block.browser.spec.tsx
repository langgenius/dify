import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ChatContextProvider } from '@/app/components/base/chat/chat/context-provider'
import ThinkBlock from '../think-block'

function ThinkingSession() {
  const [responding, setResponding] = useState(true)
  return (
    <ChatContextProvider chatList={[]} isResponding={responding}>
      <ThinkBlock data-think>
        <p>Reasoning in progress</p>
      </ThinkBlock>
      <button type="button" onClick={() => setResponding(false)}>
        Stop response
      </button>
    </ChatContextProvider>
  )
}

afterEach(() => vi.useRealTimers())

it('freezes elapsed time after the public stop action and keeps the completed thought operable', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date('2026-11-08T00:00:00Z'))
  const screen = await render(<ThinkingSession />)

  expect(
    screen
      .getByText(/common\.chat\.thinking/)
      .first()
      .element()
      .checkVisibility(),
  ).toBe(true)
  const content = screen.getByText('Reasoning in progress')
  expect(content.element().checkVisibility()).toBe(true)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(screen.getByText('(1.0s)').element().checkVisibility()).toBe(true)

  await screen.getByRole('button', { name: 'Stop response' }).click()
  expect(
    screen
      .getByText(/common\.chat\.thought/)
      .first()
      .element()
      .checkVisibility(),
  ).toBe(true)
  expect(content.element().checkVisibility()).toBe(false)
  const frozenTime = screen.getByText(/\(\d+\.\ds\)/).element().textContent
  await vi.advanceTimersByTimeAsync(2_000)
  expect(screen.getByText(/\(\d+\.\ds\)/).element().textContent).toBe(frozenTime)

  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  // Native Tab and Enter must operate the completed disclosure.
  await userEvent.keyboard('{Enter}')
  expect(content.element().checkVisibility()).toBe(true)
  await userEvent.keyboard('{Enter}')
  expect(content.element().checkVisibility()).toBe(false)
})

it('removes a nested completion marker and presents the finished thought as a disclosure', async () => {
  const screen = await render(
    <ChatContextProvider chatList={[]} isResponding>
      <ThinkBlock data-think>
        <span>Nested conclusion[ENDTHINKFLAG]</span>
      </ThinkBlock>
    </ChatContextProvider>,
  )

  await expect.element(screen.getByText('common.chat.thought')).toBeVisible()
  await expect.element(screen.getByText(/ENDTHINKFLAG/)).not.toBeInTheDocument()
  await userEvent.keyboard('{Tab}')
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('Nested conclusion')).toBeVisible()
})
