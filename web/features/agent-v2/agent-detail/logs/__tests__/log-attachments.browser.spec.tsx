import type { AgentLogMessageListResponse } from '@dify/contracts/api/console/agent/types.gen'
import { Drawer } from '@langgenius/dify-ui/drawer'
import { page } from 'vite-plus/test/browser'
import { renderChatOwner } from '@/app/components/base/chat/chat/__tests__/chat-owner-preset'
import { TEST_AGENT_ID } from '@/test/console/ids'
import { installFakeApi } from '@/test/fake-api'
import { AgentLogDetailPanel } from '../components/log-detail-panel'

vi.unmock('react-i18next')

const CONVERSATION_ID = '00000000-0000-4000-8000-000000000002'
const MESSAGE_ID = '00000000-0000-4000-8000-000000000003'
const INPUT_FILE_ID = '00000000-0000-4000-8000-000000000011'
const LEGACY_FILE_ID = '00000000-0000-4000-8000-000000000012'
const OUTPUT_FILE_ID = '00000000-0000-4000-8000-000000000013'

const response: AgentLogMessageListResponse = {
  data: [
    {
      id: MESSAGE_ID,
      message_id: MESSAGE_ID,
      conversation_id: CONVERSATION_ID,
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
          id: INPUT_FILE_ID,
          filename: 'input.pdf',
          type: 'document',
          mime_type: 'application/pdf',
          size: 20,
          transfer_method: 'local_file',
          belongs_to: 'user',
          url: 'https://files.test/input.pdf?sign=input',
        },
        {
          id: LEGACY_FILE_ID,
          filename: 'legacy.pdf',
          type: 'document',
          mime_type: 'application/pdf',
          size: 20,
          transfer_method: 'remote_url',
          belongs_to: null,
          url: 'https://files.test/legacy.pdf',
        },
        {
          id: OUTPUT_FILE_ID,
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

it('renders user and generated attachments on their messages and downloads the signed destinations', async () => {
  await page.viewport(1000, 800)
  onTestFinished(
    installFakeApi({
      console: {
        agent: {
          byAgentId: {
            logs: {
              byConversationId: {
                messages: {
                  get: () => response,
                },
              },
            },
            traceRuns: {
              byMessageId: {
                get: () => ({
                  source_id: MESSAGE_ID,
                  source_kind: 'message',
                  status: 'not_collected',
                }),
              },
            },
          },
        },
      },
    }),
  )
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
        agentId={TEST_AGENT_ID}
        log={{
          id: CONVERSATION_ID,
          conversation_id: CONVERSATION_ID,
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
    .element(page.getByRole('button', { name: 'generated.pdf', exact: true }))
    .toBeVisible()
  await expect
    .element(question.getByRole('button', { name: 'generated.pdf', exact: true }))
    .not.toBeInTheDocument()
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
