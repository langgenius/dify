import type { ChatItem } from '../../types'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import Chat from '../index'
import { chatItem, renderChatOwner } from './chat-owner-preset'

vi.unmock('react-i18next')
// boundary: Chat consumes Next route params; no application router runs here.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

beforeEach(async () => {
  await page.viewport(1200, 800)
  onTestFinished(guardUnexpectedFetch())
})

const first = chatItem({ id: 'first-answer', content: 'First answer' })
const second = chatItem({ id: 'second-answer', content: 'Second answer', workflow_run_id: 'run-1' })

function LogOwner({
  name,
  items,
  enabled = true,
  onlyRuns = false,
}: {
  name: string
  items: ChatItem[]
  enabled?: boolean
  onlyRuns?: boolean
}) {
  const [selected, setSelected] = useState<ChatItem>()
  const [parentClicks, setParentClicks] = useState(0)
  return (
    <section aria-label={name} style={{ height: 300 }}>
      <div
        role="presentation"
        onClick={() => setParentClicks((count) => count + 1)}
        style={{ height: 240 }}
      >
        <Chat
          chatList={items}
          noChatInput
          onOpenLog={enabled ? setSelected : undefined}
          canOpenLog={onlyRuns ? (item) => !!item.workflow_run_id : undefined}
        />
      </div>
      <output aria-label="Opened log">
        {selected ? `${selected.id}: ${selected.content}` : 'No log selected'}
      </output>
      <output aria-label="Surface activations">{parentClicks}</output>
    </section>
  )
}

it('opens the selected answer in its own chat without activating the surrounding surface', async () => {
  await renderChatOwner(
    <>
      <LogOwner name="First chat" items={[first]} />
      <LogOwner name="Second chat" items={[second]} />
    </>,
  )
  const firstChat = page.getByRole('region', { name: 'First chat' })
  const secondChat = page.getByRole('region', { name: 'Second chat' })
  await secondChat.getByText('Second answer', { exact: true }).hover()
  await secondChat.getByRole('button', { name: 'Log', exact: true }).click()
  await expect
    .element(secondChat.getByRole('status', { name: 'Opened log' }))
    .toHaveTextContent('second-answer: Second answer')
  await expect
    .element(firstChat.getByRole('status', { name: 'Opened log' }))
    .toHaveTextContent('No log selected')
  await expect
    .element(secondChat.getByRole('status', { name: 'Surface activations' }))
    .toHaveTextContent('0')
  await firstChat.getByText('First answer', { exact: true }).hover()
  await firstChat.getByRole('button', { name: 'Log', exact: true }).click()
  await expect
    .element(firstChat.getByRole('status', { name: 'Opened log' }))
    .toHaveTextContent('first-answer: First answer')
  await expect
    .element(secondChat.getByRole('status', { name: 'Opened log' }))
    .toHaveTextContent('second-answer: Second answer')
})

it('withdraws the log capability through public props', async () => {
  const screen = await renderChatOwner(<LogOwner name="Chat" items={[first]} />)
  await page.getByText('First answer').hover()
  await expect.element(page.getByRole('button', { name: 'Log', exact: true })).toBeVisible()
  await screen.rerender(<LogOwner name="Chat" items={[first]} enabled={false} />)
  await expect
    .element(page.getByRole('button', { name: 'Log', exact: true }))
    .not.toBeInTheDocument()
})

it('opens only the answer accepted by the log owner', async () => {
  await renderChatOwner(<LogOwner name="Chat" items={[first, second]} onlyRuns />)
  await page.getByText('Second answer').hover()
  expect(page.getByRole('button', { name: 'Log', exact: true }).all()).toHaveLength(1)
  await page.getByRole('button', { name: 'Log', exact: true }).click()
  await expect
    .element(page.getByRole('status', { name: 'Opened log' }))
    .toHaveTextContent('second-answer: Second answer')
})
