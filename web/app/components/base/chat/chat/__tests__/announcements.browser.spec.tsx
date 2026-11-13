import { page } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { AgentRosterResponseContent } from '../answer/agent-roster-response-content'
import Chat from '../index'
import { chatItem, renderChatOwner } from './chat-owner-preset'

vi.unmock('react-i18next')
// boundary: the component reads route params outside a running Next app.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

it('announces response lifecycle while the real agent renderer streams, keeping tokens out of the live region', async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
  const history = [chatItem({ id: 'history', content: 'Old answer' })]
  const renderer = (props: Parameters<typeof AgentRosterResponseContent>[0]) => (
    <AgentRosterResponseContent {...props} />
  )
  const screen = await renderChatOwner(
    <Chat chatList={history} noChatInput renderAgentContent={renderer} />,
  )
  const status = page.getByRole('status')
  await expect.element(status).toBeEmptyDOMElement()
  await expect.element(status).toHaveAttribute('aria-atomic', 'true')
  await expect.element(page.getByText('Old answer')).toBeVisible()
  await screen.rerender(
    <Chat chatList={history} noChatInput renderAgentContent={renderer} isResponding />,
  )
  await expect.element(status).toHaveTextContent('Thinking')
  const streaming = [
    ...history,
    chatItem({
      id: 'new',
      content: '',
      agent_response_parts: [{ type: 'message', content: 'First token' }],
    }),
  ]
  await screen.rerender(
    <Chat chatList={streaming} noChatInput renderAgentContent={renderer} isResponding />,
  )
  await expect.element(page.getByText('First token')).toBeVisible()
  await expect.element(status).toHaveTextContent('Thinking')
  await screen.rerender(
    <Chat chatList={streaming} noChatInput renderAgentContent={renderer} isResponding={false} />,
  )
  await expect.element(status).toHaveTextContent('Response ended')
  await screen.rerender(
    <Chat chatList={history} noChatInput renderAgentContent={renderer} isResponding={false} />,
  )
  await expect.element(status).toHaveTextContent('Response ended')
  await screen.rerender(
    <Chat chatList={history} noChatInput renderAgentContent={renderer} isResponding />,
  )
  await expect.element(status).toHaveTextContent('Thinking')
  await screen.rerender(<Chat chatList={[]} noChatInput isResponding />)
  await expect.element(status).not.toBeInTheDocument()
})
