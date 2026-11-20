import type { AgentLogMessageListResponse } from '@dify/contracts/api/console/agent/types.gen'
import { Drawer } from '@langgenius/dify-ui/drawer'
import { page } from 'vite-plus/test/browser'
import { renderChatOwner } from '@/app/components/base/chat/chat/__tests__/chat-owner-preset'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { AgentLogDetailPanel } from '../components/log-detail-panel'

vi.unmock('react-i18next')
// boundary: file previews read Next route params without a running application.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

const response: AgentLogMessageListResponse = {
  data: [
    {
      id: 'message-1',
      message_id: 'message-1',
      conversation_id: 'conversation-1',
      query: 'Create a report from these files',
      answer: 'Your report is ready',
      status: 'success',
      feedback_enabled: true,
      feedbacks: [],
      message_tokens: 3,
      answer_tokens: 4,
      total_tokens: 7,
      total_price: '0',
      currency: 'USD',
      latency: 1,
      message_files: [
        {
          id: 'input',
          filename: 'input.pdf',
          type: 'document',
          mime_type: 'application/pdf',
          size: 20,
          transfer_method: 'local_file',
          belongs_to: 'user',
          url: 'https://files.test/input.pdf?sign=input',
        },
        {
          id: 'legacy',
          filename: 'legacy.pdf',
          type: 'document',
          mime_type: 'application/pdf',
          size: 20,
          transfer_method: 'remote_url',
          belongs_to: null,
          url: 'https://files.test/legacy.pdf',
        },
        {
          id: 'output',
          filename: 'generated.pdf',
          type: 'document',
          mime_type: 'application/pdf',
          size: 42,
          transfer_method: 'tool_file',
          belongs_to: 'assistant',
          url: 'https://files.test/generated.pdf?sign=output',
        },
      ],
    },
  ],
  has_more: false,
  page: 1,
  limit: 100,
  total: 1,
}

// boundary: generated Console transport provides messages and trace availability.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.logs.byConversationId.messages.get': async () => response,
      'agent.byAgentId.traceRuns.byMessageId.get': async () => ({ status: 'not_collected' }),
    }),
  }
})

it('renders user and generated attachments on their messages and downloads the signed destinations', async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
  const downloads: { name: string; url: string }[] = []
  // boundary: prevent external navigation while observing the real download anchors.
  const captureDownload = (event: MouseEvent) => {
    if (event.target instanceof HTMLAnchorElement && event.target.download) {
      event.preventDefault()
      downloads.push({ name: event.target.download, url: event.target.href })
    }
  }
  document.addEventListener('click', captureDownload, true)
  onTestFinished(() => document.removeEventListener('click', captureDownload, true))

  await renderChatOwner(
    <Drawer open>
      <AgentLogDetailPanel
        agentId="agent-1"
        log={{
          id: 'conversation-1',
          conversation_id: 'conversation-1',
          message_count: 1,
          unread: false,
          status: 'success',
          source: { id: 'webapp:app-1', app_id: 'app-1', app_name: 'Agent', type: 'webapp' },
        }}
        onClose={() => {}}
      />
    </Drawer>,
  )

  const question = page.getByTestId('question-content')
  await expect
    .element(question.getByRole('button', { name: 'input.pdf', exact: true }))
    .toBeVisible()
  await expect
    .element(question.getByRole('button', { name: 'legacy.pdf', exact: true }))
    .toBeVisible()
  await expect
    .element(question.getByRole('button', { name: 'generated.pdf', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'generated.pdf', exact: true }))
    .toBeVisible()
  for (const name of ['input.pdf', 'generated.pdf']) {
    await page.getByRole('button', { name, exact: true }).hover()
    await page.getByRole('button', { name: 'Download', exact: true }).click()
  }
  expect(downloads).toEqual([
    { name: 'input.pdf', url: 'https://files.test/input.pdf?sign=input&as_attachment=true' },
    {
      name: 'generated.pdf',
      url: 'https://files.test/generated.pdf?sign=output&as_attachment=true',
    },
  ])
})
