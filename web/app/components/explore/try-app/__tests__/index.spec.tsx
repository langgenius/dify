import type { ComponentProps } from 'react'
import type { consoleClient } from '@/service/console'
import { zParameters } from '@dify/contracts/api/console/trial-apps/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createTrialAppDetailFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import TryApp from '../index'

const api = vi.hoisted(() => ({
  detail: vi.fn<typeof consoleClient.trialApps.byAppId.get>(),
  stream: vi.fn<(typeof import('@/service/base'))['ssePost']>(),
  parameters: vi.fn<typeof consoleClient.trialApps.byAppId.parameters.get>(),
  workflow: vi.fn<typeof consoleClient.trialApps.byAppId.workflows.get>(),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost: api.stream,
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({}),
  usePathname: () => '/apps',
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'trialApps.byAppId.get': api.detail,
      'trialApps.byAppId.workflows.get': api.workflow,
      'workspaces.current.toolProviders.get': async () => [],
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'trialApps.byAppId.parameters.get': api.parameters,
    }),
  }
})

type Props = Omit<ComponentProps<typeof TryApp>, 'onClose' | 'onCreate'>
const fixture = () =>
  createTrialAppDetailFixture({ id: 'canonical-template', name: 'Sample template' })
const createButton = () =>
  screen.getByRole('button', { name: 'explore.tryApp.createFromSampleApp' })
const detailTab = () => screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.detail' })
const tryTab = () => screen.getByRole('tab', { name: 'explore.tryApp.tabHeader.try' })

function Harness({ onCreate, ...props }: Props & { onCreate: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>Preview template</button>
      {open && <TryApp {...props} onCreate={onCreate} onClose={() => setOpen(false)} />}
    </>
  )
}
async function setup(props: Partial<Props> = {}) {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  const onCreate = vi.fn()
  await act(async () =>
    renderWithConsoleQuery(
      <NuqsTestingAdapter>
        <Harness
          appId="canonical-template"
          templateName="Sample template"
          canTrial
          onCreate={onCreate}
          {...props}
        />
      </NuqsTestingAdapter>,
      { queryClient, features: {}, systemFeatures: { enable_collaboration_mode: false } },
    ),
  )
  return { user: userEvent.setup(), onCreate }
}

const parameters = (overrides: Partial<Awaited<ReturnType<typeof api.parameters>>> = {}) =>
  zParameters.parse({
    annotation_reply: {},
    file_upload: {},
    more_like_this: {},
    retriever_resource: {},
    sensitive_word_avoidance: {},
    speech_to_text: {},
    suggested_questions: [],
    suggested_questions_after_answer: {},
    text_to_speech: {},
    user_input_form: [],
    opening_statement: 'Welcome to this template',
    system_parameters: {
      audio_file_size_limit: 10,
      file_size_limit: 10,
      image_file_size_limit: 10,
      video_file_size_limit: 10,
      workflow_file_upload_limit: 10,
    },
    ...overrides,
  })

beforeEach(() => {
  api.detail.mockReset().mockResolvedValue(fixture())
  api.workflow.mockReset().mockResolvedValue(createWorkflowResponseFixture())
  api.parameters.mockReset().mockResolvedValue(parameters())
  api.stream.mockReset().mockImplementation(async (_url, _request, handlers) => {
    handlers.onData?.('Template answer', true, {
      conversationId: 'conversation-1',
      messageId: 'message-1',
      taskId: 'task-1',
    })
    await handlers.onCompleted?.()
  })
})

it.each(['completion', 'workflow'] as const)(
  'submits real %s trial inputs and displays the generated result and dismissible notice',
  async (mode) => {
    api.detail.mockResolvedValue(createTrialAppDetailFixture({ ...fixture(), mode }))
    api.parameters.mockResolvedValue(
      parameters({
        user_input_form: [{ 'text-input': { label: 'Topic', variable: 'topic', required: true } }],
      }),
    )
    if (mode === 'workflow') {
      api.stream.mockImplementation(async (_url, _request, handlers) => {
        handlers.onWorkflowStarted?.({
          event: 'workflow_started',
          task_id: 'task-1',
          workflow_run_id: 'run-1',
          data: { id: 'run-1', workflow_id: 'workflow-1', created_at: 1 },
        })
        handlers.onWorkflowFinished?.({
          event: 'workflow_finished',
          task_id: 'task-1',
          workflow_run_id: 'run-1',
          data: {
            id: 'run-1',
            workflow_id: 'workflow-1',
            status: 'succeeded',
            outputs: { answer: 'Template answer' },
            error: '',
            elapsed_time: 1,
            total_tokens: 10,
            total_steps: 2,
            created_at: 1,
            finished_at: 2,
            created_by: { id: 'user-1', name: 'User', email: 'user@example.com' },
          },
        })
      })
    }
    const { user } = await setup()
    await screen.findByRole('button', { name: 'explore.tryApp.createFromSampleApp' })
    await user.click(tryTab())
    const trial = await screen.findByRole('tabpanel', { name: 'explore.tryApp.tabHeader.try' })
    await user.type(await within(trial).findByRole('textbox', { name: /Topic/ }), 'Science')
    expect(within(trial).queryByText('explore.tryApp.tryInfo')).not.toBeInTheDocument()
    await user.click(within(trial).getByRole('button', { name: /share.generation.run/ }))
    expect(await within(trial).findByText('Template answer')).toBeInTheDocument()
    expect(api.stream).toHaveBeenCalledWith(
      `trial-apps/canonical-template/${mode === 'workflow' ? 'workflows/run' : 'completion-messages'}`,
      { body: { inputs: { topic: 'Science' }, response_mode: 'streaming' } },
      expect.anything(),
    )
    expect(within(trial).getByText('explore.tryApp.tryInfo')).toBeInTheDocument()
    await user.click(within(trial).getByRole('button', { name: 'common.operation.close' }))
    expect(within(trial).queryByText('explore.tryApp.tryInfo')).not.toBeInTheDocument()
    expect(within(trial).getByText('Template answer')).toBeInTheDocument()
  },
)

it('keeps template identity and tabs during loading, then shows real requirements and catalog categories', async () => {
  const request = createDeferred<ReturnType<typeof fixture>>()
  api.detail.mockReturnValue(request.promise)
  await setup({ categories: ['AI Assistant', 'Workflow'] })
  expect(screen.getByRole('dialog', { name: 'Sample template' })).toBeInTheDocument()
  expect(tryTab()).toHaveAttribute('aria-disabled', 'true')
  expect(
    screen.queryByRole('button', { name: 'explore.tryApp.createFromSampleApp' }),
  ).not.toBeInTheDocument()
  await act(async () => request.resolve(fixture()))
  expect(
    await screen.findByRole('button', { name: 'explore.tryApp.createFromSampleApp' }),
  ).toBeEnabled()
  expect(tryTab()).not.toHaveAttribute('aria-disabled', 'true')
  expect(detailTab()).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('AI Assistant')).toBeInTheDocument()
  expect(screen.getByText('Workflow')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'explore.tryApp.requirements' })).toBeInTheDocument()
  expect(screen.getByText('openai')).toBeInTheDocument()
})

it('preserves template identity on failure and resets the error to loading when reopened', async () => {
  api.detail.mockRejectedValueOnce(new Error('Unavailable'))
  const { user } = await setup()
  await screen.findByRole('button', { name: 'common.operation.retry' })
  expect(screen.getByRole('alert')).toHaveTextContent('explore.tryApp.loadError')
  expect(tryTab()).toHaveAttribute('aria-disabled', 'true')
  expect(
    screen.queryByRole('button', { name: 'explore.tryApp.createFromSampleApp' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  const request = createDeferred<ReturnType<typeof fixture>>()
  api.detail.mockReturnValue(request.promise)
  await user.click(screen.getByRole('button', { name: 'Preview template' }))
  expect(screen.getByRole('dialog', { name: 'Sample template' })).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()
  await act(async () => request.reject(new Error('Still unavailable')))
  expect(await screen.findByRole('button', { name: 'common.operation.retry' })).toBeEnabled()
})

it('preserves the error while retrying, prevents duplicate requests, and restores usable detail controls', async () => {
  const request = createDeferred<ReturnType<typeof fixture>>()
  api.detail.mockRejectedValueOnce(new Error('Unavailable')).mockReturnValueOnce(request.promise)
  const { user, onCreate } = await setup()
  await user.click(await screen.findByRole('button', { name: 'common.operation.retry' }))
  const retrying = screen.getByRole('button', { name: 'explore.tryApp.retrying' })
  expect(screen.getByRole('alert')).toBeVisible()
  expect(retrying).toHaveAttribute('aria-disabled', 'true')
  await user.click(retrying)
  expect(api.detail).toHaveBeenCalledTimes(2)
  await act(async () => request.resolve(fixture()))
  await waitFor(() => expect(detailTab()).toHaveFocus())
  await user.click(createButton())
  expect(onCreate).toHaveBeenCalledOnce()
})

it('allows another retry after a failed retry', async () => {
  api.detail
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockRejectedValueOnce(new Error('Still unavailable'))
  const { user } = await setup()
  await user.click(await screen.findByRole('button', { name: 'common.operation.retry' }))
  await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2))
  await user.click(await screen.findByRole('button', { name: 'common.operation.retry' }))
  expect(
    await screen.findByRole('button', { name: 'explore.tryApp.createFromSampleApp' }),
  ).toBeEnabled()
  expect(api.detail).toHaveBeenCalledTimes(3)
})

it('hides trial and creation when the caller grants neither capability', async () => {
  await setup({ canTrial: false, canCreate: false })
  await screen.findByRole('heading', { name: 'explore.tryApp.requirements' })
  expect(
    screen.queryByRole('tab', { name: 'explore.tryApp.tabHeader.try' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'explore.tryApp.createFromSampleApp' }),
  ).not.toBeInTheDocument()
})

it('loads the actual trial conversation with the canonical ID and returns to its template details', async () => {
  const { user } = await setup()
  await screen.findByRole('button', { name: 'explore.tryApp.createFromSampleApp' })
  await user.click(tryTab())
  const trial = await screen.findByRole('tabpanel', { name: 'explore.tryApp.tabHeader.try' })
  expect(await within(trial).findByText('Welcome to this template')).toBeInTheDocument()
  expect(api.detail).toHaveBeenCalledWith({ params: { app_id: 'canonical-template' } })
  expect(api.parameters).toHaveBeenCalledWith({ params: { app_id: 'canonical-template' } })
  await user.click(within(trial).getByRole('button', { name: 'common.operation.close' }))
  expect(within(trial).queryByText('explore.tryApp.tryInfo')).not.toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Sample template' })).toBeInTheDocument()
  await user.click(detailTab())
  expect(screen.getByRole('tabpanel', { name: 'explore.tryApp.tabHeader.detail' })).toBeVisible()
  expect(
    screen.queryByRole('tabpanel', { name: 'explore.tryApp.tabHeader.try' }),
  ).not.toBeInTheDocument()
})

it('uses real trial inputs, exposes conversation settings after a reply, and resets the conversation', async () => {
  api.parameters.mockResolvedValue(
    parameters({
      user_input_form: [{ 'text-input': { label: 'Topic', variable: 'topic', required: true } }],
    }),
  )
  const { user } = await setup()
  await screen.findByRole('button', { name: 'explore.tryApp.createFromSampleApp' })
  await user.click(tryTab())
  const trial = await screen.findByRole('tabpanel', { name: 'explore.tryApp.tabHeader.try' })
  expect(
    within(trial).queryByRole('button', { name: 'share.chat.resetChat' }),
  ).not.toBeInTheDocument()
  expect(
    within(trial).queryByRole('button', { name: 'share.chat.viewChatSettings' }),
  ).not.toBeInTheDocument()
  await user.type(await within(trial).findByRole('textbox', { name: /Topic/ }), 'Science')
  await user.click(within(trial).getByRole('button', { name: 'share.chat.startChat' }))
  await user.type(
    within(trial).getByPlaceholderText(/^common.chat.inputPlaceholder/),
    'Explain gravity',
  )
  await user.click(within(trial).getByRole('button', { name: 'common.operation.send' }))
  expect(await within(trial).findByText('Template answer')).toBeInTheDocument()
  expect(api.stream).toHaveBeenCalledWith(
    'trial-apps/canonical-template/chat-messages',
    {
      body: expect.objectContaining({ query: 'Explain gravity', inputs: { topic: 'Science' } }),
    },
    expect.anything(),
  )
  await user.click(
    await within(trial).findByRole('button', { name: 'share.chat.viewChatSettings' }),
  )
  expect(await screen.findByRole('textbox', { name: /Topic/ })).toHaveValue('Science')
  await user.keyboard('{Escape}')
  await user.click(within(trial).getByRole('button', { name: 'share.chat.resetChat' }))
  await waitFor(() => expect(within(trial).queryByText('Template answer')).not.toBeInTheDocument())
  expect(
    within(trial).queryByRole('button', { name: 'share.chat.viewChatSettings' }),
  ).not.toBeInTheDocument()
  expect(
    within(trial).queryByRole('button', { name: 'share.chat.resetChat' }),
  ).not.toBeInTheDocument()
})
