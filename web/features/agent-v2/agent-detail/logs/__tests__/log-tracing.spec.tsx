import type {
  AgentLogConversationItemResponse,
  AgentLogMessageItemResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import { Drawer } from '@langgenius/dify-ui/drawer'
import { render, screen, waitFor } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { AgentLogDetailPanel } from '../components/log-detail-panel'

const { request } = vi.hoisted(() => ({
  // oxlint-disable-next-line typescript/no-deprecated -- Observe the existing transport boundary without mocking the tracing UI.
  request: vi.fn<typeof import('@/service/base').request>(),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request,
}))

const message: AgentLogMessageItemResponse = {
  id: 'message-1',
  message_id: 'message-1',
  conversation_id: 'conversation-1',
  query: 'First question',
  answer: 'First answer',
  status: 'success',
  answer_tokens: 1,
  message_tokens: 1,
  total_tokens: 2,
  total_price: '0',
  currency: 'USD',
  latency: 1,
}
const log: AgentLogConversationItemResponse = {
  id: 'conversation-1',
  conversation_id: 'conversation-1',
  title: 'Conversation',
  message_count: 2,
  status: 'success',
  unread: false,
  source: { id: 'webapp:app-1', type: 'webapp', app_id: 'app-1', app_name: 'Agent' },
}

it.each(['webapp', 'workflow'] as const)(
  'keeps each %s message trace attached to its real execution',
  async (sourceType) => {
    const urls: string[] = []
    request.mockImplementation(async (url, _init, options) => {
      const path = new URL(options?.request?.url ?? String(url), 'https://example.com').pathname
      urls.push(path)
      if (path.includes('/trace-runs/'))
        return Response.json({
          status: 'accepted',
          source_kind: sourceType === 'workflow' ? 'workflow' : 'message',
          source_id: path.split('/').at(-1),
          provider: 'langfuse',
          trace_url: `https://traces.example.com/${path.split('/').at(-1)}`,
        })
      if (path.includes('/logs/'))
        return Response.json({
          data: [
            message,
            {
              ...message,
              id: 'message-2',
              message_id: 'message-2',
              query: 'Second question',
              answer: 'Second answer',
            },
          ],
          total: 2,
          page: 1,
          limit: 100,
        })
      throw new Error(`Unexpected request: ${path}`)
    })
    const { wrapper } = createConsoleQueryWrapper()
    render(
      <Drawer open>
        <AgentLogDetailPanel
          agentId="agent-1"
          log={{ ...log, source: { ...log.source!, type: sourceType, app_id: 'caller-app' } }}
          onClose={() => {}}
        />
      </Drawer>,
      { wrapper },
    )
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'app.tracing.run.viewTrace' })).toHaveLength(2),
    )
    const links = screen.getAllByRole('link', { name: 'app.tracing.run.viewTrace' })
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://traces.example.com/message-1',
      'https://traces.example.com/message-2',
    ])
    const owner =
      sourceType === 'workflow' ? '/apps/caller-app/trace-runs/node' : '/agent/agent-1/trace-runs'
    expect(urls.some((url) => url.endsWith(`${owner}/message-1`))).toBe(true)
    expect(urls.some((url) => url.endsWith(`${owner}/message-2`))).toBe(true)
  },
)
