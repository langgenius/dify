import type { AgentLogResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { toast } from '@/app/notifications'
import { createDeferred } from '@/test/deferred'
import { apiError, setupFakeApi } from '@/test/fake-api'
import AgentLogModal from '../index'
import { renderAgentLog } from './browser-test-env'

// The contract requires UUID app ids.
const appId = '0f8e2c1a-7b3d-4e5f-8a9b-0c1d2e3f4a5b'
const oldAppId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const newAppId = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e'

vi.unmock('react-i18next')
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
          appId={appId}
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

const fake = setupFakeApi(() => ({
  console: {
    apps: {
      byAppId: { agent: { logs: { get: () => response('User') } } },
    },
  },
}))

beforeEach(() => {
  toast.dismiss()
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
  fake.console.apps.byAppId.agent.logs.get.mockImplementationOnce(() => oldResponse.promise)
  fake.console.apps.byAppId.agent.logs.get.mockResolvedValueOnce(response('New executor'))
  const { rerender, screen } = await renderAgentLog(
    <AgentLogModal appId={oldAppId} currentLogItem={log} onCancel={() => {}} width={1000} />,
  )

  await rerender(
    <AgentLogModal appId={newAppId} currentLogItem={log} onCancel={() => {}} width={1000} />,
  )
  await expect.element(screen.getByText('New executor')).toBeVisible()
  oldResponse.resolve(response('Old executor'))
  await expect.element(screen.getByText('New executor')).toBeVisible()
  await expect.element(screen.getByText('Old executor')).not.toBeInTheDocument()
})

it('preserves the selected tracing view when another message replaces the record', async () => {
  await page.viewport(1200, 800)
  const { rerender, screen } = await renderAgentLog(
    <AgentLogModal appId={appId} currentLogItem={log} onCancel={() => {}} width={1000} />,
  )
  await expect.element(screen.getByText('User')).toBeVisible()
  const tracing = screen.getByRole('button', { name: 'TRACING' })
  await tracing.click()
  await expect.element(screen.getByText('Final Processing')).toBeVisible()

  await rerender(
    <AgentLogModal
      appId={appId}
      currentLogItem={{ ...log, id: 'next-message' }}
      onCancel={() => {}}
      width={1000}
    />,
  )
  await expect.element(screen.getByText('Final Processing')).toBeVisible()
  await expect.element(tracing).toHaveFocus()
  expect(fake.console.apps.byAppId.agent.logs.get).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: { app_id: appId },
      query: { conversation_id: 'conv-id', message_id: 'next-message' },
    }),
  )
})

it('ignores a failed request after its record has been replaced', async () => {
  const oldResponse = createDeferred<AgentLogResponse>()
  fake.console.apps.byAppId.agent.logs.get.mockImplementationOnce(() => oldResponse.promise)
  const { rerender, screen } = await renderAgentLog(
    <AgentLogModal appId={oldAppId} currentLogItem={log} onCancel={() => {}} width={1000} />,
  )
  await rerender(
    <AgentLogModal appId={newAppId} currentLogItem={log} onCancel={() => {}} width={1000} />,
  )
  await expect.element(screen.getByText('User')).toBeVisible()
  oldResponse.reject(
    apiError({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Old request failed' }),
  )
  await expect.element(screen.getByText('User')).toBeVisible()
  await expect
    .element(screen.getByRole('dialog', { name: 'Old request failed' }))
    .not.toBeInTheDocument()
})
