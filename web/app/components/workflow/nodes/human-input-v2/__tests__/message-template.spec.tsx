import type { ComponentProps } from 'react'
import type { Shape } from '@/app/components/workflow/hooks-store/store'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { createHooksStore } from '@/app/components/workflow/hooks-store/store'
import { VarType } from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'
import MessageTemplate from '../components/message-template'

const mocks = vi.hoisted(() => ({
  isChatMode: false,
  syncDraft: vi.fn<Shape['doSyncWorkflowDraft']>(),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useIsChatMode: () => mocks.isChatMode,
}))

vi.mock('@/app/components/workflow/hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ doSyncWorkflowDraft: mocks.syncDraft }),
}))

vi.mock(
  '@/app/components/workflow/nodes/human-input/components/delivery-method/mail-body-input',
  () => ({
    __esModule: true,
    default: ({
      value,
      onChange,
      readOnly,
    }: {
      value: string
      onChange: (value: string) => void
      readOnly: boolean
    }) => (
      <textarea
        aria-label="message-body-editor"
        value={value}
        disabled={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    ),
  }),
)

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: (props: { onChange: (value: string[]) => void }) => (
    <button
      type="button"
      aria-label="insert-subject-variable"
      onClick={() => props.onChange(['start', 'email'])}
    />
  ),
}))

const renderTemplate = (
  overrides: Partial<ComponentProps<typeof MessageTemplate>> = {},
  storeOverrides: Partial<Shape> = {},
) => {
  const props: ComponentProps<typeof MessageTemplate> = {
    nodeId: 'human-input-v2',
    value: { subject: 'Original subject', body: 'Original body' },
    onChange: vi.fn(),
    readonly: false,
    availableVars: [],
    availableNodes: [],
    ...overrides,
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const hooksStore = createHooksStore({
    configsMap: {
      flowId: 'app-template-test',
      flowType: FlowType.appFlow,
      fileSettings: { enabled: false },
    },
    ...storeOverrides,
  })
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <HooksStoreContext value={hooksStore}>
          <MessageTemplate {...props} />
        </HooksStoreContext>
      </QueryClientProvider>,
    ),
    props,
    hooksStore,
  }
}

const openTemplate = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByText('workflow.nodes.humanInputV2.template.title'))
}

const openTest = async (user: ReturnType<typeof userEvent.setup>) => {
  await openTemplate(user)
  await user.click(
    screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.test' }),
  )
}

const sendTest = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.saveAndTest' }),
  )
}

type RecordedRequest = { url: string; method: string; body: unknown }

const jsonResponse = (body: unknown = {}, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const setupFetch = (respond: () => Response | Promise<Response> = () => jsonResponse()) => {
  const requests: RecordedRequest[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (resource, options) => {
    const request = resource instanceof Request ? resource : new Request(resource, options)
    requests.push({
      url: request.url,
      method: request.method,
      body: await request.clone().json(),
    })
    return respond()
  })
  return requests
}

describe('Human Input v2 Message Template', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isChatMode = false
    mocks.syncDraft.mockImplementation(async (_notRefresh, callbacks) => {
      callbacks?.onSuccess?.()
      return { hash: 'saved-draft', updatedAt: 1 }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens from node data, inserts variables, and commits subject/body atomically', async () => {
    const user = userEvent.setup()
    const { props } = renderTemplate()
    await openTemplate(user)

    const subject = screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')
    const body = screen.getByLabelText('message-body-editor')
    expect(subject).toHaveValue('Original subject')
    expect(body).toHaveValue('Original body')

    await user.click(screen.getByRole('button', { name: 'insert-subject-variable' }))
    expect(subject).toHaveValue('Original subject{{#start.email#}}')
    await user.clear(body)
    await user.type(body, 'Updated body without a request URL')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(props.onChange).toHaveBeenCalledTimes(1)
    expect(props.onChange).toHaveBeenCalledWith({
      subject: 'Original subject{{#start.email#}}',
      body: 'Updated body without a request URL',
    })
  })

  it('discards local drafts on Cancel and Escape and restores trigger focus', async () => {
    const user = userEvent.setup()
    renderTemplate()
    await openTemplate(user)
    const subject = screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')
    await user.clear(subject)
    await user.type(subject, 'Unsaved')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() =>
      expect(
        screen.getByText('workflow.nodes.humanInputV2.template.title').closest('button'),
      ).toHaveFocus(),
    )
    await openTemplate(user)
    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toHaveValue(
      'Original subject',
    )

    await user.clear(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'))
    await user.type(
      screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'),
      'Discard with Escape',
    )
    await user.keyboard('{Escape}')
    await openTemplate(user)
    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toHaveValue(
      'Original subject',
    )
  })

  it('validates both local fields and does not submit twice', async () => {
    const user = userEvent.setup()
    const { props } = renderTemplate()
    await openTemplate(user)
    await user.clear(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'))
    await user.clear(screen.getByLabelText('message-body-editor'))
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(props.onChange).not.toHaveBeenCalled()

    await user.type(
      screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'),
      'Subject',
    )
    await user.type(screen.getByLabelText('message-body-editor'), 'Body')
    const save = screen.getByRole('button', { name: 'common.operation.save' })
    await user.dblClick(save)
    expect(props.onChange).toHaveBeenCalledTimes(1)
  })

  it('opens a non-mutating read-only view', async () => {
    const user = userEvent.setup()
    const { props } = renderTemplate({ readonly: true })
    await openTemplate(user)

    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toBeDisabled()
    expect(screen.getByLabelText('message-body-editor')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it.each([
    { mode: 'workflow', chat: false, prefix: 'workflows' },
    { mode: 'chatflow', chat: true, prefix: 'advanced-chat/workflows' },
  ])(
    'sends a $mode template test through its generated route after saving',
    async ({ chat, prefix }) => {
      const user = userEvent.setup()
      mocks.isChatMode = chat
      const requests = setupFetch()
      let completeSave = () => {}
      mocks.syncDraft.mockImplementationOnce(
        (_notRefresh, callbacks) =>
          new Promise((resolve) => {
            completeSave = () => {
              callbacks?.onSuccess?.()
              resolve({ hash: 'saved-new-template', updatedAt: 2 })
            }
          }),
      )
      const { props } = renderTemplate()
      await openTest(user)
      await user.clear(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'))
      await user.type(
        screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'),
        'Updated test subject',
      )
      await user.click(
        screen.getByRole('combobox', { name: 'workflow.nodes.humanInputV2.template.testChannel' }),
      )
      await user.click(
        await screen.findByRole('option', {
          name: 'workflow.nodes.humanInputV2.debug.channel.lark',
        }),
      )
      await sendTest(user)

      expect(props.onChange).toHaveBeenCalledWith({
        subject: 'Updated test subject',
        body: 'Original body',
      })
      expect(mocks.syncDraft).toHaveBeenCalledTimes(1)
      expect(requests).toHaveLength(0)

      await act(async () => completeSave())
      expect(
        await screen.findByText('workflow.nodes.humanInputV2.template.testCompleted'),
      ).toBeInTheDocument()
      expect(requests).toEqual([
        {
          url: `http://localhost:5001/console/api/apps/app-template-test/${prefix}/draft/human-input/nodes/human-input-v2/message-template/test`,
          method: 'POST',
          body: { channel: 'lark', inputs: {} },
        },
      ])
    },
  )

  it.each(['app changes', 'run permission is revoked'] as const)(
    'does not send a stale test when %s while the draft save is pending',
    async (change) => {
      const user = userEvent.setup()
      const requests = setupFetch()
      let completeSave = () => {}
      mocks.syncDraft.mockImplementationOnce(
        (_notRefresh, callbacks) =>
          new Promise((resolve) => {
            completeSave = () => {
              callbacks?.onSuccess?.()
              resolve({ hash: 'saved-before-context-change', updatedAt: 3 })
            }
          }),
      )
      const { hooksStore } = renderTemplate()
      await openTest(user)
      await sendTest(user)
      expect(mocks.syncDraft).toHaveBeenCalledTimes(1)
      expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toBeDisabled()

      await act(async () => {
        if (change === 'app changes') {
          hooksStore.setState({
            configsMap: {
              flowId: 'another-app',
              flowType: FlowType.appFlow,
              fileSettings: { enabled: false },
            },
          })
        } else {
          hooksStore.setState({
            accessControl: {
              canEdit: true,
              canRun: false,
              canImportExportDSL: true,
              canReleaseAndVersion: true,
            },
          })
        }
      })
      await act(async () => completeSave())

      await waitFor(() =>
        expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toBeEnabled(),
      )
      expect(requests).toHaveLength(0)
      expect(
        screen.queryByText('workflow.nodes.humanInputV2.template.testCompleted'),
      ).not.toBeInTheDocument()
      if (change === 'run permission is revoked') {
        expect(
          screen.queryByRole('button', { name: 'workflow.nodes.humanInputV2.template.test' }),
        ).not.toBeInTheDocument()
      }
    },
  )

  it.each(['failed', 'skipped'] as const)(
    'does not send against a %s draft save',
    async (outcome) => {
      const user = userEvent.setup()
      const requests = setupFetch()
      mocks.syncDraft.mockImplementationOnce(async (_notRefresh, callbacks) => {
        if (outcome === 'failed') callbacks?.onError?.()
        return null
      })
      renderTemplate()
      await openTest(user)
      await sendTest(user)

      expect(
        await screen.findByText('workflow.nodes.humanInputV2.template.testSaveFailed'),
      ).toBeInTheDocument()
      expect(requests).toHaveLength(0)
      expect(
        screen.queryByText('workflow.nodes.humanInputV2.template.testCompleted'),
      ).not.toBeInTheDocument()
      expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toHaveValue(
        'Original subject',
      )
    },
  )

  it('reports an unavailable backend without claiming the test was sent', async () => {
    const user = userEvent.setup()
    const requests = setupFetch(() =>
      jsonResponse(
        {
          code: 'not_implemented',
          message: 'Human Input v2 draft stub endpoint is not implemented yet.',
        },
        501,
      ),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderTemplate()
    await openTest(user)
    await sendTest(user)

    expect(
      await screen.findByText('workflow.nodes.humanInputV2.template.testUnavailable'),
    ).toBeInTheDocument()
    expect(requests).toHaveLength(1)
    expect(
      screen.queryByText('workflow.nodes.humanInputV2.template.testCompleted'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.saveAndTest' }),
    ).toBeEnabled()
  })

  it('deduplicates subject and body variables, preserving zero and string-array input types', async () => {
    const user = userEvent.setup()
    const requests = setupFetch()
    renderTemplate({
      value: {
        subject: 'Review {{#start.score#}} and {{#start.owner#}}',
        body: '{{#start.score#}} {{#start.tags#}} {{#url#}} {{#env.secret#}}',
      },
      availableVars: [
        {
          nodeId: 'start',
          title: 'Start',
          vars: [
            { variable: 'score', type: VarType.number },
            { variable: 'owner', type: VarType.string },
            { variable: 'tags', type: VarType.arrayString },
          ],
        },
      ],
    })
    await openTest(user)
    expect(screen.getAllByLabelText('start.score')).toHaveLength(1)
    expect(screen.queryByLabelText('url')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('env.secret')).not.toBeInTheDocument()
    await sendTest(user)
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.template.testInputsRequired'),
    ).toBeInTheDocument()
    expect(mocks.syncDraft).not.toHaveBeenCalled()
    expect(requests).toHaveLength(0)

    await user.type(screen.getByLabelText('start.score'), '0')
    await user.type(screen.getByLabelText('start.owner'), 'Reviewer')
    await user.click(screen.getByLabelText('start.tags'))
    await user.paste('["urgent", "legal"]')
    await sendTest(user)
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.template.testCompleted'),
    ).toBeInTheDocument()
    expect(requests[0]?.body).toEqual({
      channel: 'email',
      inputs: {
        '#start.score#': 0,
        '#start.owner#': 'Reviewer',
        '#start.tags#': ['urgent', 'legal'],
      },
    })
  })

  it.each(['["valid", 1]', 'not JSON'])(
    'rejects invalid string-array test input %s before saving',
    async (input) => {
      const user = userEvent.setup()
      const requests = setupFetch()
      renderTemplate({
        value: { subject: 'Subject', body: '{{#start.tags#}}' },
        availableVars: [
          {
            nodeId: 'start',
            title: 'Start',
            vars: [{ variable: 'tags', type: VarType.arrayString }],
          },
        ],
      })
      await openTest(user)
      await user.click(screen.getByLabelText('start.tags'))
      await user.paste(input)
      await sendTest(user)
      expect(
        await screen.findByText('workflow.errorMsg.invalidJson:{"field":"start.tags"}'),
      ).toBeInTheDocument()
      expect(mocks.syncDraft).not.toHaveBeenCalled()
      expect(requests).toHaveLength(0)
    },
  )

  it('keeps one request in flight when the send button is double-clicked', async () => {
    const user = userEvent.setup()
    let finishRequest = (_response: Response) => {}
    const requests = setupFetch(
      () =>
        new Promise((resolve) => {
          finishRequest = resolve
        }),
    )
    const { props } = renderTemplate()
    await openTest(user)
    const send = screen.getByRole('button', {
      name: 'workflow.nodes.humanInputV2.template.saveAndTest',
    })
    await user.dblClick(send)
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(mocks.syncDraft).toHaveBeenCalledTimes(1)
    expect(props.onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toBeDisabled()

    await act(async () => finishRequest(jsonResponse()))
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.template.testCompleted'),
    ).toBeInTheDocument()
    expect(requests).toHaveLength(1)
  })

  it.each([
    {
      reason: 'read-only',
      readonly: true,
      canRun: true,
      flowType: FlowType.appFlow,
      flowId: 'app-template-test',
    },
    {
      reason: 'no run permission',
      readonly: false,
      canRun: false,
      flowType: FlowType.appFlow,
      flowId: 'app-template-test',
    },
    {
      reason: 'snippet',
      readonly: false,
      canRun: true,
      flowType: FlowType.snippet,
      flowId: 'snippet-1',
    },
    {
      reason: 'missing app ID',
      readonly: false,
      canRun: true,
      flowType: FlowType.appFlow,
      flowId: '',
    },
  ])('does not offer test sending for $reason', async ({ readonly, canRun, flowType, flowId }) => {
    const user = userEvent.setup()
    const requests = setupFetch()
    renderTemplate(
      { readonly },
      {
        accessControl: {
          canEdit: true,
          canRun,
          canImportExportDSL: true,
          canReleaseAndVersion: true,
        },
        configsMap: { flowId, flowType, fileSettings: { enabled: false } },
      },
    )
    await openTemplate(user)
    expect(
      screen.queryByRole('button', { name: 'workflow.nodes.humanInputV2.template.test' }),
    ).not.toBeInTheDocument()
    expect(mocks.syncDraft).not.toHaveBeenCalled()
    expect(requests).toHaveLength(0)
  })
})
