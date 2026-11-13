import { page, userEvent } from 'vite-plus/test/browser'
import {
  createChatAnnotationFixture,
  createChatConfigFixture,
  createChatThoughtFixture,
} from '@/test/fixtures/chat'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { chatItem, renderChatOwner } from '../../__tests__/chat-owner-preset'
import { AgentRosterResponseContent } from '../agent-roster-response-content'
import Answer from '../index'

vi.unmock('react-i18next')
// boundary: real attachment owners read params without a running Next router.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})

it('replaces the visible answer with saved annotations, including an intentionally empty answer', async () => {
  const item = chatItem({ content: 'Original answer' })
  const screen = await renderChatOwner(<Answer item={item} question="Question" index={0} />)
  await expect.element(page.getByText('Original answer')).toBeVisible()
  await screen.rerender(
    <Answer
      item={{ ...item, annotation: createChatAnnotationFixture('Edited answer') }}
      question="Question"
      index={0}
    />,
  )
  await expect.element(page.getByText('Edited answer')).toBeVisible()
  await expect.element(page.getByText('Original answer')).not.toBeInTheDocument()
  await expect.element(page.getByText('Answer edited by Editor')).toBeVisible()
  await screen.rerender(
    <Answer
      item={{ ...item, annotation: createChatAnnotationFixture('') }}
      question="Question"
      index={0}
    />,
  )
  await expect.element(page.getByText('Edited answer')).not.toBeInTheDocument()
  await expect.element(page.getByText('Original answer')).not.toBeInTheDocument()
})

it.each(['\\\\server\\share\\file.txt', '`\\\\server\\share\\file.txt`', '\\not-a-unc'])(
  'preserves readable backslashes in the actual answer: %s',
  async (content) => {
    await renderChatOwner(<Answer item={chatItem({ content })} question="Question" index={0} />)
    const text = page.getByText(content.startsWith('`') ? content.slice(1, -1) : content, {
      exact: true,
    })
    await expect.element(text).toBeVisible()
    const element = text.element()
    const bounds = element.getBoundingClientRect()
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
  },
)

it('shows thoughts through the default renderer before answer text arrives', async () => {
  await renderChatOwner(
    <Answer
      item={chatItem({
        content: '',
        agent_thoughts: [createChatThoughtFixture({ thought: 'Thinking about the request' })],
      })}
      question="Question"
      index={0}
    />,
  )
  await expect.element(page.getByText('Thinking about the request')).toBeVisible()
})

it('passes thought visibility to the actual custom agent renderer for response-part-only answers', async () => {
  const item = chatItem({
    content: '',
    agent_response_parts: [
      { type: 'thought', thought: createChatThoughtFixture({ thought: 'Public reasoning' }) },
      { type: 'message', content: 'Streamed answer' },
    ],
  })
  const renderer = (props: Parameters<typeof AgentRosterResponseContent>[0]) => (
    <AgentRosterResponseContent {...props} />
  )
  const screen = await renderChatOwner(
    <Answer
      item={item}
      question="Question"
      index={0}
      renderAgentContent={renderer}
      responding
      config={createChatConfigFixture({ show_thoughts: { enabled: true } })}
    />,
  )
  await expect.element(page.getByText('Public reasoning')).toBeVisible()
  await expect.element(page.getByText('Streamed answer')).toBeVisible()
  await screen.rerender(
    <Answer
      item={item}
      question="Question"
      index={0}
      renderAgentContent={renderer}
      responding
      config={createChatConfigFixture({ show_thoughts: { enabled: false } })}
    />,
  )
  await expect.element(page.getByText('Public reasoning')).not.toBeInTheDocument()
  await expect.element(page.getByText('Streamed answer')).toBeVisible()
})

it('exposes response metadata on real pointer hover', async () => {
  await renderChatOwner(
    <Answer
      item={chatItem({
        more: { latency: 1.5, tokens: 1200, time: '2026-01-01', tokens_per_second: 20 },
      })}
      question="Question"
      index={0}
    />,
  )
  const metadata = page.getByText('20 tokens/s', { exact: true })
  await expect.element(metadata).toBeInTheDocument()
  const summary = page.getByTestId('more-container')
  await expect.element(summary).toBeInTheDocument()
  await userEvent.unhover(document.body)
  await expect.poll(() => getComputedStyle(summary.element()).opacity).toBe('0')
  await page.getByText('An answer', { exact: true }).hover()
  await expect.poll(() => getComputedStyle(summary.element()).opacity).toBe('1')
  await expect.element(page.getByText(/1\.5s/)).toBeVisible()
  await expect.element(page.getByText('Token spent 1,200')).toBeVisible()
})
