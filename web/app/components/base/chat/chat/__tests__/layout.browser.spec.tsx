import type { ChatItem } from '../../types'
import { page } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import Chat from '../index'
import { chatItem, renderChatOwner } from './chat-owner-preset'

vi.unmock('react-i18next')
// boundary: layout is rendered without a Next application/router.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})

const history: ChatItem[] = Array.from({ length: 16 }, (_, i) =>
  chatItem({
    id: `message-${i}`,
    isAnswer: i % 2 === 1,
    content: `Message ${i + 1}: ${'Readable conversation content. '.repeat(4)}`,
  }),
)

const shell = (messages: ChatItem[], sidebarCollapseState = true) => (
  <div style={{ width: '70vw', height: 420 }}>
    <Chat
      chatList={messages}
      sidebarCollapseState={sidebarCollapseState}
      inputPlaceholder="Reply"
    />
  </div>
)

// https://github.com/langgenius/dify/issues/46120: lazy Markdown expands after the initial scroll.
it.fails('scrolls restored history above the composer after lazy Markdown content appears', async () => {
  await renderChatOwner(shell(history))
  const last = page.getByText(/^Message 16:/)
  const footer = page.getByTestId('chat-footer')
  await expect.element(last).toBeVisible()
  await expect.element(footer).toBeVisible()
  const lastElement = last.element()
  const footerElement = footer.element()
  await expect
    .poll(() => lastElement.getBoundingClientRect().bottom)
    .toBeLessThanOrEqual(footerElement.getBoundingClientRect().top + 1)
})

it('keeps the final message above a growing composer and aligns it after a real viewport/sidebar resize', async () => {
  const screen = await renderChatOwner(shell(history))
  const container = page.getByTestId('chat-container')
  const footer = page.getByTestId('chat-footer')
  const last = page.getByText(/^Message 16:/)
  await expect.element(last).toBeVisible()
  await expect.element(footer).toBeVisible()
  // The initial mount regression is tracked above; the user scrolls to the latest
  // message before editing their reply and changing the viewport.
  await container.wheel({ delta: { y: 10000 } })
  await expect.element(container).toBeVisible()
  const viewport = container.element()
  const footerElement = footer.element()
  const lastElement = last.element()
  const input = page.getByPlaceholder('Reply')
  await expect.element(input).toBeVisible()
  const inputElement = input.element()
  const assertUnobstructed = () => {
    const contentBounds = viewport.getBoundingClientRect()
    const footerBounds = footerElement.getBoundingClientRect()
    const lastBounds = lastElement.getBoundingClientRect()
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)
    expect(lastBounds.bottom).toBeLessThanOrEqual(footerBounds.top + 1)
    expect(lastBounds.top).toBeGreaterThanOrEqual(contentBounds.top)
    expect(footerBounds.width).toBeCloseTo(viewport.clientWidth, 0)
    expect(inputElement.getBoundingClientRect().width).toBeGreaterThan(viewport.clientWidth / 2)
    return true
  }
  await expect.poll(assertUnobstructed).toBe(true)
  await page.getByPlaceholder('Reply').fill('One\nTwo\nThree\nFour\nFive')
  await expect.poll(() => footerElement.getBoundingClientRect().height).toBeGreaterThan(100)
  await expect.poll(assertUnobstructed).toBe(true)
  await page.viewport(700, 800)
  await screen.rerender(shell(history, false))
  await expect.poll(() => viewport.getBoundingClientRect().width).toBeCloseTo(490, 0)
  await expect
    .poll(() => footerElement.getBoundingClientRect().width)
    .toBeCloseTo(viewport.clientWidth, 0)
  await expect
    .poll(() => footerElement.getBoundingClientRect().bottom)
    .toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom + 1)
})

it('respects manual scroll during updates and resumes auto-scroll for a different conversation', async () => {
  const screen = await renderChatOwner(shell(history))
  const container = page.getByTestId('chat-container')
  await expect.element(page.getByText(/^Message 16:/)).toBeVisible()
  await expect.element(container).toBeVisible()
  const viewport = container.element()
  await container.wheel({ delta: { y: 10000 } })
  await expect
    .poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop)
    .toBeLessThan(2)
  await container.wheel({ delta: { y: -10000 } })
  await expect.poll(() => viewport.scrollTop).toBe(0)
  await screen.rerender(
    shell([...history, chatItem({ id: 'new', content: 'New streamed answer' })], false),
  )
  await expect.element(page.getByText('New streamed answer')).toBeInTheDocument()
  await expect.poll(() => viewport.scrollTop).toBe(0)
  const next = history.map((item) => ({
    ...item,
    id: `next-${item.id}`,
    content: item.content.replace('Message', 'Next conversation'),
  }))
  await screen.rerender(shell(next))
  await expect.element(page.getByText(/^Next conversation 16:/)).toBeVisible()
  await expect
    .poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop)
    .toBeLessThan(2)
})
