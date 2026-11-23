import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderChat } from '../../__tests__/chat-browser-test-env'
import ReasoningPanel from '../reasoning-panel'

vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(800, 600)
  onTestFinished(guardUnexpectedFetch())
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('freezes the observed thinking time and collapses completed reasoning even if done flips back', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const screen = await renderChat(<ReasoningPanel content={{ llm: 'thinking' }} done={false} />)
  await expect.element(screen.getByText('thinking', { exact: true })).toBeVisible()
  clock.mockReturnValue(1700)
  await vi.advanceTimersByTimeAsync(700)
  await expect.element(screen.getByText('(0.7s)')).toBeVisible()
  await screen.rerender(<ReasoningPanel content={{ llm: 'thinking' }} done />)
  const summary = screen.getByText(/^Thought/)
  await expect.element(summary).toBeVisible()
  await expect.element(screen.getByText('thinking', { exact: true })).not.toBeVisible()
  await screen.rerender(<ReasoningPanel content={{ llm: 'thinking' }} done={false} />)
  clock.mockReturnValue(2700)
  await vi.advanceTimersByTimeAsync(1000)
  await expect.element(screen.getByText('(0.7s)')).toBeVisible()
  await userEvent.tab()
  await expect.poll(() => document.activeElement?.contains(summary.element())).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('thinking', { exact: true })).toBeVisible()
  await expect.poll(() => document.activeElement?.contains(summary.element())).toBe(true)
  await userEvent.keyboard('{Space}')
  await expect.element(screen.getByText('thinking', { exact: true })).not.toBeVisible()
})

it('keeps historical reasoning collapsed without starting a timer', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const screen = await renderChat(<ReasoningPanel content={{ llm: 'done thinking' }} done />)
  clock.mockReturnValue(2700)
  await vi.advanceTimersByTimeAsync(1000)
  await expect.element(screen.getByText('(0.0s)')).toBeVisible()
  await expect.element(screen.getByText('done thinking')).not.toBeVisible()
  await screen.getByText(/^Thought/).click()
  await expect.element(screen.getByText('done thinking')).toBeVisible()
})

it('renders in-place streaming deltas from separate nodes as readable reasoning', async () => {
  const content: Record<string, string> = {}
  const screen = await renderChat(<ReasoningPanel content={content} done={false} />)
  await expect.element(screen.getByText(/^Thinking/)).not.toBeInTheDocument()
  content.llm = 'first'
  await screen.rerender(<ReasoningPanel content={content} done={false} />)
  await expect.element(screen.getByText('first', { exact: true })).toBeVisible()
  content.llm = 'first delta'
  content.second = 'another node'
  await screen.rerender(<ReasoningPanel content={content} done={false} />)
  const first = screen.getByText('first delta', { exact: true })
  const second = screen.getByText('another node', { exact: true })
  await expect.element(first).toBeVisible()
  await expect.element(second).toBeVisible()
  expect(second.element().getBoundingClientRect().top).toBeGreaterThan(
    first.element().getBoundingClientRect().bottom,
  )
  await expect.element(screen.getByText('first', { exact: true })).not.toBeInTheDocument()
})
