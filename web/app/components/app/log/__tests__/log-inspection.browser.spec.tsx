import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import ConversationList from '../list'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/service/base', () => ({
  get,
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
  getPublic: vi.fn(),
  delPublic: vi.fn(),
  patchPublic: vi.fn(),
  upload: vi.fn(),
  postPublic: vi.fn(),
  getMarketplace: vi.fn(),
  postMarketplace: vi.fn(),
  sseGet: vi.fn(),
  ssePost: vi.fn(),
  sseGeneratorPost: vi.fn(),
  request: vi.fn(),
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  usePathname: () => '/app/app-1/logs',
}))

const clients: ReturnType<typeof createConsoleQueryWrapper>['queryClient'][] = []
const runDetail = {
  id: 'run-1',
  status: 'succeeded',
  inputs: {},
  outputs: { answer: 'Workflow output' },
  total_tokens: 12,
  total_steps: 1,
  elapsed_time: 0.5,
  created_at: 1710000000,
  created_by_role: 'account',
  created_by_account: { name: 'Operator' },
}

beforeEach(async () => {
  await page.viewport(1440, 900)
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = false
  get.mockReset()
  get.mockImplementation(async (path: string) => {
    if (path.endsWith('/chat-messages'))
      return {
        has_more: false,
        data: [
          {
            id: 'message-1',
            answer: 'Inspected workflow answer',
            query: 'Question',
            created_at: 1710000000,
            inputs: {},
            feedbacks: [],
            message: [],
            message_files: [],
            answer_tokens: 10,
            message_tokens: 2,
            workflow_run_id: 'run-1',
          },
        ],
      }
    if (path.endsWith('/node-executions')) return { data: [] }
    if (path.endsWith('/workflow-runs/run-1')) return runDetail
    if (path.includes('/default-model')) return { data: null }
    throw new Error(`Unexpected get: ${path}`)
  })
})
afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = true
})

it('keeps the real workflow inspection session through exit and restores the visible log entry', async () => {
  const { queryClient } = createConsoleQueryWrapper()
  clients.push(queryClient)
  queryClient.setQueryData(['log', 'chat-conversation-detail', 'app-1', 'conversation-1'], {
    id: 'conversation-1',
    name: 'Conversation',
    model_config: { user_input_form: [], configs: {} },
    message: { inputs: {} },
  })
  await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter searchParams="?conversation_id=conversation-1" hasMemory>
        <ConversationList
          appDetail={createAppDetailFixture({ id: 'app-1', mode: AppModeEnum.ADVANCED_CHAT })}
          logs={{ data: [], has_more: false, limit: 20, page: 1, total: 0 }}
          onRefresh={vi.fn()}
        />
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  const answer = page.getByText('Inspected workflow answer', { exact: true })
  await expect.element(answer).toBeVisible()
  const entry = page.getByRole('button', { name: 'common.operation.log', exact: true })
  await page.getByRole('heading', { name: 'appLog.detail.conversationId' }).hover()
  for (let index = 0; index < 12 && document.activeElement !== entry.element(); index++)
    await userEvent.tab()
  await expect.element(entry).toHaveFocus()
  expect(entry.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  const modal = page.getByRole('dialog', { name: 'appLog.runDetail.title', exact: true }).last()
  await expect
    .element(modal.getByRole('tab', { name: 'runLog.detail', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .poll(() => get.mock.calls.some(([path]) => path.endsWith('/workflow-runs/run-1')))
    .toBe(true)
  await expect
    .poll(() => get.mock.calls.some(([path]) => path.endsWith('/node-executions')))
    .toBe(true)
  await modal.getByRole('tab', { name: 'runLog.tracing', exact: true }).click()
  const popup = modal.element()
  const tracing = modal.getByRole('tab', { name: 'runLog.tracing', exact: true }).element()
  const exitStates: boolean[] = []
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style'))
      exitStates.push(tracing.isConnected && tracing.getAttribute('aria-selected') === 'true')
  })
  await modal.getByRole('button', { name: 'common.operation.close', exact: true }).hover()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => exitStates.length).toBeGreaterThan(0)
  expect(exitStates.every(Boolean)).toBe(true)
  await expect.poll(() => popup.isConnected).toBe(false)
  await expect.element(entry).toHaveFocus()
  expect(entry.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect
    .element(modal.getByRole('tab', { name: 'runLog.detail', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
})
