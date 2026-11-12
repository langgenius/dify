import type { AgentLogResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import AgentLogModal from '../index'
import { renderAgentLog } from './browser-test-env'

const fetchAgentLogDetail = vi.hoisted(() => vi.fn())

vi.unmock('react-i18next')
// boundary: Monaco workers do not run in the Browser test bundle; readonly editor values stay real.
vi.mock('@monaco-editor/react', async () => {
  const { createMonacoEditorModuleMock } = await import('@/test/monaco-editor-mock')
  return createMonacoEditorModuleMock()
})

// boundary: agent log records come from Console HTTP; modal race handling stays real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.agent.logs.get': fetchAgentLogDetail,
    }),
  }
})

const log: IChatItem = {
  id: 'msg-id',
  conversationId: 'conv-id',
  content: 'content',
  isAnswer: false,
  input: 'test input',
}

const response = (executor: string): AgentLogResponse => ({
  meta: {
    status: 'succeeded',
    executor,
    start_time: '2023-01-01',
    elapsed_time: 1,
    total_tokens: 100,
    agent_mode: 'function_call',
    iterations: 1,
  },
  iterations: [
    {
      created_at: '',
      files: [],
      thought: 'Final response',
      tokens: 1,
      tool_raw: { inputs: '', outputs: '' },
      tool_calls: [],
    },
  ],
  files: [],
})

function ControlledModal({ floating = false }: { floating?: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button">Outside agent log</button>
      {open ? (
        <AgentLogModal
          appId="app-id"
          currentLogItem={log}
          floating={floating}
          onCancel={() => setOpen(false)}
          width={1000}
        />
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setOpen(true)
          }}
        >
          Reopen agent log
        </button>
      )}
    </>
  )
}

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  toast.dismiss()
  fetchAgentLogDetail.mockReset()
  fetchAgentLogDetail.mockResolvedValue(response('User'))
})

it('closes and reopens the portalled dialog through its real controls', async () => {
  await page.viewport(1200, 800)
  const { screen } = await renderAgentLog(<ControlledModal floating />)
  const dialog = screen.getByRole('dialog', { name: 'Log Detail' })
  await expect.element(dialog).toBeVisible()

  await screen.getByRole('button', { name: 'Close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Reopen agent log' }).click()
  await expect.element(dialog).toBeVisible()
})

it('closes the inline viewer only for an outside interaction', async () => {
  await page.viewport(1200, 800)
  const { screen } = await renderAgentLog(<ControlledModal />)
  const title = screen.getByRole('heading', { name: 'Log Detail' })
  await title.click()
  await expect.element(title).toBeVisible()

  await screen.getByRole('button', { name: 'Outside agent log' }).click()
  await expect.element(title).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'Reopen agent log' }).click()
  await expect.element(title).toBeVisible()
})

it('keeps the new record visible when the previous response arrives late', async () => {
  const oldResponse = createDeferred<AgentLogResponse>()
  fetchAgentLogDetail.mockImplementationOnce(() => oldResponse.promise)
  fetchAgentLogDetail.mockResolvedValueOnce(response('New executor'))
  const { rerender, screen } = await renderAgentLog(
    <AgentLogModal appId="old-app" currentLogItem={log} onCancel={() => {}} width={1000} />,
  )

  await rerender(
    <AgentLogModal appId="new-app" currentLogItem={log} onCancel={() => {}} width={1000} />,
  )
  await expect.element(screen.getByText('New executor')).toBeVisible()
  oldResponse.resolve(response('Old executor'))
  await expect.element(screen.getByText('New executor')).toBeVisible()
  await expect.element(screen.getByText('Old executor')).not.toBeInTheDocument()
})

it('preserves the selected tracing view when another message replaces the record', async () => {
  await page.viewport(1200, 800)
  const { rerender, screen } = await renderAgentLog(
    <AgentLogModal appId="app-id" currentLogItem={log} onCancel={() => {}} width={1000} />,
  )
  await expect.element(screen.getByText('User')).toBeVisible()
  const tracing = screen.getByRole('button', { name: 'TRACING' })
  await tracing.click()
  await expect.element(screen.getByText('Final Processing')).toBeVisible()

  await rerender(
    <AgentLogModal
      appId="app-id"
      currentLogItem={{ ...log, id: 'next-message' }}
      onCancel={() => {}}
      width={1000}
    />,
  )
  await expect.element(screen.getByText('Final Processing')).toBeVisible()
  await expect.element(tracing).toHaveFocus()
  expect(fetchAgentLogDetail).toHaveBeenLastCalledWith(
    {
      params: { app_id: 'app-id' },
      query: { conversation_id: 'conv-id', message_id: 'next-message' },
    },
    { context: { silent: true } },
  )
})

it('ignores a failed request after its record has been replaced', async () => {
  const oldResponse = createDeferred<AgentLogResponse>()
  fetchAgentLogDetail.mockImplementationOnce(() => oldResponse.promise)
  const { rerender, screen } = await renderAgentLog(
    <AgentLogModal appId="old-app" currentLogItem={log} onCancel={() => {}} width={1000} />,
  )
  await rerender(
    <AgentLogModal appId="new-app" currentLogItem={log} onCancel={() => {}} width={1000} />,
  )
  await expect.element(screen.getByText('User')).toBeVisible()
  oldResponse.reject(new Error('Old request failed'))
  await expect.element(screen.getByText('User')).toBeVisible()
  await expect
    .element(screen.getByRole('dialog', { name: 'Old request failed' }))
    .not.toBeInTheDocument()
})
