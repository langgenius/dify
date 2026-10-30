import type { ComponentProps } from 'react'
import type { Shape } from '../../store/workflow'
import type { HumanInputFilledFormData, HumanInputFormData } from '@/types/workflow'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { useNodes } from 'reactflow'
import {
  createNode,
  createNodeTracing,
  createStartNode,
  createWorkflowRunningData,
} from '@/app/components/workflow/__tests__/fixtures'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum, InputVarType, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { submitHumanInputForm } from '@/service/workflow'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import WorkflowPreview from '../workflow-preview'

vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }))
const getChildExecutions = vi.hoisted(() =>
  vi.fn<
    typeof import('@/service/console').consoleClient.apps.byAppId.workflowRuns.byRunId.nodeExecutions.byNodeExecutionId.children.get
  >(),
)
const preflight = vi.hoisted(() =>
  vi.fn<
    typeof import('@/service/console').consoleClient.apps.byAppId.workflows.draft.testCredentials.preflight.post
  >(),
)
const credentialInfo = vi.hoisted(() => vi.fn())
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: credentialInfo,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflowRuns.byRunId.nodeExecutions.byNodeExecutionId.children.get':
        getChildExecutions,
      'apps.byAppId.workflows.draft.testCredentials.preflight.post': preflight,
    }),
  }
})
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  submitHumanInputForm: vi.fn(),
}))
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createInstance } = await vi.importActual<typeof import('i18next')>('i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: translations } = await import('@/i18n/locales/en-US/workflow.json')
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    fallbackLng: false,
    keySeparator: false,
    resources: { 'en-US': { workflow: translations } },
  })
  return {
    ...actual,
    ...createReactI18nextMock(),
    Trans: (props: ComponentProps<typeof actual.Trans>) => <actual.Trans {...props} i18n={i18n} />,
  }
})

const renderPreview = (options: Parameters<typeof renderWorkflowEditor>[1] = {}) =>
  renderWorkflowEditor(<WorkflowPreview />, options)
const mockSubmitHumanInputForm = vi.mocked(submitHumanInputForm)
type PreviewRun = NonNullable<Shape['workflowRunningData']>
const createPreviewRunningData = (overrides: Partial<PreviewRun> = {}): PreviewRun => ({
  ...createWorkflowRunningData(),
  ...overrides,
})

type WorkflowResult = NonNullable<ReturnType<typeof createWorkflowRunningData>['result']>

const createWorkflowResult = (overrides: Partial<WorkflowResult> = {}): WorkflowResult => ({
  status: WorkflowRunningStatus.Running,
  inputs_truncated: false,
  process_data_truncated: false,
  outputs_truncated: false,
  ...overrides,
})

const createHumanInputFormData = (
  overrides: Partial<HumanInputFormData> = {},
): HumanInputFormData => ({
  form_id: 'form-1',
  node_id: 'human-node-1',
  node_title: 'Need Approval',
  form_content: 'Before {{#$output.reason#}} after',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'reason',
      default: { type: 'constant', value: '', selector: [] },
    },
  ],
  actions: [{ id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary }],
  form_token: 'token-1',
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: 2_000_000_000,
  ...overrides,
})

const createHumanInputFilledFormData = (
  overrides: Partial<HumanInputFilledFormData> = {},
): HumanInputFilledFormData => ({
  form_id: 'form-1',
  node_id: 'node-1',
  node_title: 'Previous approval',
  rendered_content: 'Already approved',
  action_id: 'approve',
  action_text: 'Approve',
  ...overrides,
})

const createConnectionTool = (id = 'tool-1', data: Record<string, unknown> = {}) =>
  createNode({
    id,
    data: {
      type: BlockEnum.Tool,
      title: `Tool ${id}`,
      provider_id: 'provider',
      provider_name: 'Test Provider',
      provider_type: 'builtin',
      tool_name: 'search',
      tool_parameters: {},
      tool_configurations: {},
      credential_source: 'end_user',
      end_user_auth: { allowed_credential_types: ['api-key'] },
      test_credential_id: 'key-1',
      ...data,
    },
  })

function ConnectionGraph() {
  const nodes = useNodes()
  return <output aria-label="Connection graph">{JSON.stringify(nodes)}</output>
}
const readConnectionGraph = () =>
  JSON.parse(screen.getByLabelText('Connection graph').textContent!) as ReturnType<
    typeof createNode
  >[]

const connectionReadiness = (status: 'connected' | 'invalid' = 'connected') => ({
  ready: status === 'connected',
  credentials: [
    { node_id: 'tool-1', node_ids: ['tool-1'], credential_id: 'key-1', status, check: null },
  ],
})

const renderConnectionPreview = ({
  startNode = createStartNode(),
  nodes = [createConnectionTool()],
  sync = vi.fn(async () => ({ hash: 'hash', updatedAt: 1 })),
  handleRun = vi.fn(),
  initialStoreState = {},
}: {
  startNode?: ReturnType<typeof createStartNode>
  nodes?: ReturnType<typeof createNode>[]
  sync?: () => Promise<{ hash: string; updatedAt: number } | null>
  handleRun?: (params: unknown) => void
  initialStoreState?: Partial<Shape>
} = {}) => {
  const { queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  })
  queryClient.setQueryData(consoleQuery.workspaces.current.tools.builtin.get.queryKey(), [])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get.queryKey(
      {
        input: { params: { provider: 'provider', credential_type: 'api-key' } },
      },
    ),
    [],
  )
  const rendered = renderWorkflowEditor(
    <>
      <WorkflowPreview />
      <ConnectionGraph />
    </>,
    {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      nodes: [startNode, ...nodes],
      edges: [],
      initialStoreState: {
        showDebugAndPreviewPanel: true,
        showInputsPanel: true,
        ...initialStoreState,
      },
      hooksStoreProps: { handleRun, doSyncWorkflowDraft: sync },
      queryClient,
    },
  )
  return { ...rendered, sync, handleRun }
}

beforeEach(() => {
  getChildExecutions.mockReset()
  mockSubmitHumanInputForm.mockReset().mockResolvedValue({ result: 'success' })
  vi.mocked(copy).mockReset().mockResolvedValue(true)
  vi.spyOn(toast, 'success')
  preflight.mockReset().mockResolvedValue({ ready: true, credentials: [] })
  credentialInfo.mockReset().mockResolvedValue({
    credentials: [
      {
        id: 'key-1',
        name: 'Workspace key',
        provider: 'provider',
        credential_type: 'api-key',
        is_default: true,
      },
    ],
    supported_credential_types: ['api-key'],
    allow_custom_token: true,
  })
})
afterEach(() => vi.restoreAllMocks())

it('validates the real input form before starting a run and clears the preview state on close', async () => {
  const user = userEvent.setup()
  const handleRun = vi.fn()
  const { store } = renderPreview({
    nodes: [
      createStartNode({
        data: {
          variables: [
            {
              type: InputVarType.textInput,
              variable: 'query',
              label: 'Question',
              required: true,
              max_length: 100,
            },
          ],
        },
      }),
    ],
    initialStoreState: { showInputsPanel: true, showDebugAndPreviewPanel: true },
    hooksStoreProps: { handleRun },
  })
  const run = screen.getByRole('button', { name: 'workflow.singleRun.startRun' })
  await user.click(run)
  expect(handleRun).not.toHaveBeenCalled()
  await user.type(screen.getByRole('textbox', { name: /Question/ }), 'What is Dify?')
  await user.click(run)
  expect(handleRun).toHaveBeenCalledWith({ inputs: { query: 'What is Dify?' }, files: [] })
  expect(
    screen.queryByRole('button', { name: 'workflow.singleRun.startRun' }),
  ).not.toBeInTheDocument()
  act(() =>
    store.setState({
      workflowRunningData: createPreviewRunningData({ resultText: 'Streaming answer' }),
    }),
  )
  expect(await screen.findByText('Streaming answer')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(store.getState().showDebugAndPreviewPanel).toBe(false)
  expect(store.getState().workflowRunningData).toBeUndefined()
  expect(preflight).not.toHaveBeenCalled()
})

it('waits for draft saving and credential preflight before starting a Workflow test run', async () => {
  const user = userEvent.setup()
  let finishSaving!: (value: { hash: string; updatedAt: number }) => void
  let finishPreflight!: (value: ReturnType<typeof connectionReadiness>) => void
  const sync = vi.fn(
    () =>
      new Promise<{ hash: string; updatedAt: number }>((resolve) => {
        finishSaving = resolve
      }),
  )
  preflight.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishPreflight = resolve
      }),
  )
  const { handleRun } = renderConnectionPreview({ sync })

  expect(screen.getByText('Test Run')).toBeVisible()
  expect(screen.getByRole('region', { name: 'share.connections.configure.title' })).toBeVisible()
  const run = screen.getByRole('button', { name: 'workflow.singleRun.startRun' })
  await user.click(run)
  expect(sync).toHaveBeenCalledOnce()
  expect(preflight).not.toHaveBeenCalled()
  expect(handleRun).not.toHaveBeenCalled()
  expect(run).toHaveAttribute('aria-disabled', 'true')

  await act(async () => finishSaving({ hash: 'saved', updatedAt: 1 }))
  await waitFor(() => expect(preflight).toHaveBeenCalledWith({ params: { app_id: 'app-1' } }))
  expect(handleRun).not.toHaveBeenCalled()
  await act(async () => finishPreflight(connectionReadiness()))
  await waitFor(() => expect(handleRun).toHaveBeenCalledExactlyOnceWith({ inputs: {}, files: [] }))
  expect(
    screen.queryByRole('button', { name: 'workflow.singleRun.startRun' }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'share.connections.configure.title' })).toBeVisible()
})

it('validates required inputs before saving and checking test credentials', async () => {
  const user = userEvent.setup()
  preflight.mockResolvedValue(connectionReadiness())
  const { sync, handleRun } = renderConnectionPreview({
    startNode: createStartNode({
      data: {
        variables: [
          {
            type: InputVarType.textInput,
            variable: 'query',
            label: 'Question',
            required: true,
            max_length: 100,
          },
        ],
      },
    }),
  })
  const run = screen.getByRole('button', { name: 'workflow.singleRun.startRun' })
  await user.click(run)
  expect(sync).not.toHaveBeenCalled()
  expect(preflight).not.toHaveBeenCalled()
  expect(handleRun).not.toHaveBeenCalled()

  await user.type(screen.getByRole('textbox', { name: /Question/ }), 'What is Dify?')
  await user.click(run)
  await waitFor(() =>
    expect(handleRun).toHaveBeenCalledWith({ inputs: { query: 'What is Dify?' }, files: [] }),
  )
})

it.each(['invalid', 'request-error', 'save-error'] as const)(
  'keeps connection setup and does not run after %s',
  async (failure) => {
    const user = userEvent.setup()
    if (failure === 'request-error') preflight.mockRejectedValue(new Error('preflight unavailable'))
    else preflight.mockResolvedValue(connectionReadiness('invalid'))
    const sync = vi.fn(async () =>
      failure === 'save-error' ? null : { hash: 'saved', updatedAt: 1 },
    )
    const { handleRun } = renderConnectionPreview({ sync })

    await user.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))
    const setup = screen.getByRole('region', { name: 'share.connections.configure.title' })
    if (failure === 'invalid')
      expect(await within(setup).findByRole('status')).toHaveTextContent('plugin.auth.unavailable')
    else
      expect(await within(setup).findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(screen.getByRole('button', { name: 'workflow.singleRun.startRun' })).toBeEnabled()
    expect(handleRun).not.toHaveBeenCalled()
    if (failure === 'save-error') expect(preflight).not.toHaveBeenCalled()
  },
)

it('saves only the selected independent authentication root and leaves reuse and workspace nodes out of setup', async () => {
  const user = userEvent.setup()
  const sync = vi.fn(async () => ({ hash: 'saved', updatedAt: 1 }))
  preflight.mockResolvedValue({
    ready: false,
    credentials: [
      ...connectionReadiness().credentials,
      {
        node_id: 'tool-2',
        node_ids: ['tool-2'],
        credential_id: null,
        status: 'disconnected',
        check: null,
      },
    ],
  })
  renderConnectionPreview({
    nodes: [
      createConnectionTool('tool-1', { test_credential_id: undefined }),
      createConnectionTool('tool-2', { test_credential_id: undefined }),
      createConnectionTool('reuse', { credential_source: 'reuse_node', reuse_node_id: 'tool-1' }),
      createConnectionTool('workspace', { credential_source: 'workspace' }),
    ],
    sync,
  })
  const setup = screen.getByRole('region', { name: 'share.connections.configure.title' })
  const rows = within(setup).getAllByRole('listitem', { name: 'Test Provider' })
  expect(rows).toHaveLength(2)
  expect(within(setup).queryByText('Tool reuse')).not.toBeInTheDocument()
  expect(within(setup).queryByText('Tool workspace')).not.toBeInTheDocument()
  const selector = await within(rows[0]!).findByRole('button', {
    name: /plugin.auth.appUser.testConnection/,
  })
  await user.click(selector)
  const picker = await screen.findByRole('dialog', { name: 'plugin.auth.authorization' })
  const option = await within(picker).findByRole('button', { name: /^Workspace key/ })
  expect(option).toBeEnabled()
  await user.click(option)
  await waitFor(() =>
    expect(readConnectionGraph().find((node) => node.id === 'tool-1')?.data).toHaveProperty(
      'test_credential_id',
      'key-1',
    ),
  )
  await waitFor(() => expect(sync).toHaveBeenCalledOnce())
  await waitFor(() => expect(preflight).toHaveBeenCalledOnce())
  expect(readConnectionGraph().find((node) => node.id === 'tool-2')?.data).toMatchObject({
    credential_source: 'end_user',
  })
  expect(readConnectionGraph().find((node) => node.id === 'tool-2')?.data).not.toHaveProperty(
    'test_credential_id',
  )
})

it.each([WorkflowRunningStatus.Running, WorkflowRunningStatus.Paused])(
  'prevents credential changes during an existing %s run',
  async (status) => {
    const user = userEvent.setup()
    renderConnectionPreview({
      initialStoreState: {
        showInputsPanel: false,
        workflowRunningData: createPreviewRunningData({ result: createWorkflowResult({ status }) }),
      },
    })
    const configure = screen.getByRole('button', { name: 'share.connections.configure.title' })
    await user.click(configure)
    const dialog = await screen.findByRole('dialog', { name: 'share.connections.configure.title' })
    expect(await within(dialog).findByRole('button', { name: /Workspace key/ })).toBeDisabled()
    expect(preflight).not.toHaveBeenCalled()
  },
)

it.each([
  { isListening: true, status: WorkflowRunningStatus.Running, label: 'appLog.status.running' },
  { isListening: false, status: WorkflowRunningStatus.Succeeded, label: 'appLog.status.succeeded' },
  { isListening: false, status: WorkflowRunningStatus.Failed, label: 'appLog.status.failed' },
])(
  'opens details for a listening or completed run without output: $status',
  ({ isListening, status, label }) => {
    renderPreview({
      initialStoreState: {
        isListening,
        workflowRunningData: createPreviewRunningData({
          result: createWorkflowResult({ status, files: [] }),
          resultText: '',
        }),
      },
    })
    expect(screen.getByRole('status')).toHaveTextContent(label)
  },
)

it('opens pending human input on pause and submits the token with the entered response', async () => {
  const user = userEvent.setup()
  renderPreview({
    initialStoreState: {
      workflowRunningData: createPreviewRunningData({
        result: createWorkflowResult({ status: WorkflowRunningStatus.Paused, files: [] }),
        humanInputFormDataList: [createHumanInputFormData()],
        humanInputFilledFormDataList: [createHumanInputFilledFormData()],
      }),
    },
  })
  expect(screen.getByText('Need Approval')).toBeInTheDocument()
  expect(await screen.findByText('Already approved', {}, { timeout: 5000 })).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'reason' }), 'Looks good')
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  await waitFor(() =>
    expect(mockSubmitHumanInputForm).toHaveBeenCalledWith('token-1', {
      inputs: { reason: 'Looks good' },
      action: 'approve',
    }),
  )
})

it('copies the completed output from the result tab', async () => {
  const user = userEvent.setup()
  renderPreview({
    initialStoreState: {
      workflowRunningData: createPreviewRunningData({
        result: createWorkflowResult({ status: WorkflowRunningStatus.Succeeded }),
        resultText: 'final answer',
      }),
    },
  })
  await user.click(screen.getByText('runLog.result'))
  expect(screen.getByText('final answer')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
  expect(copy).toHaveBeenCalledWith('final answer')
  expect(toast.success).toHaveBeenCalledWith('common.actionMsg.copySuccessfully')
})

it.each([false, true])('shows progress while waiting for run data, listening=%s', (isListening) => {
  renderPreview({ initialStoreState: { isListening, workflowRunningData: undefined } })
  expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
})

it('keeps the input form available until a run exists, then exposes results and node traces', async () => {
  const user = userEvent.setup()
  const { store } = renderPreview({ initialStoreState: { showInputsPanel: true } })
  for (const tab of ['result', 'detail', 'tracing'])
    await user.click(screen.getByText(`runLog.${tab}`))
  expect(screen.getByRole('button', { name: 'workflow.singleRun.startRun' })).toBeInTheDocument()
  act(() =>
    store.setState({
      workflowRunningData: createPreviewRunningData({
        result: createWorkflowResult({ status: WorkflowRunningStatus.Succeeded }),
        tracing: [createNodeTracing({ title: 'Prepare response' })],
        resultText: 'Ready',
      }),
    }),
  )
  await user.click(screen.getByText('runLog.result'))
  expect(screen.getByText('Ready')).toBeInTheDocument()
  expect(screen.queryByText(/common.chat.think/)).not.toBeInTheDocument()
  await user.click(screen.getByText('runLog.detail'))
  expect(screen.getByRole('status')).toHaveTextContent('appLog.status.succeeded')
  await user.click(screen.getByText('runLog.tracing'))
  expect(screen.getByText('Prepare response')).toBeInTheDocument()
  act(() =>
    store.setState({
      workflowRunningData: { ...store.getState().workflowRunningData!, resultText: '' },
    }),
  )
  await user.click(screen.getByText('runLog.result'))
  await user.click(screen.getByRole('button', { name: 'runLog.resultEmpty.link' }))
  expect(screen.getByRole('status')).toHaveTextContent('appLog.status.succeeded')
})

it('combines node reasoning and marks it complete when the answer begins streaming', async () => {
  const user = userEvent.setup()
  const { store } = renderPreview({
    initialStoreState: {
      workflowRunningData: createPreviewRunningData({
        resultText: '',
        reasoningContent: { 'llm-1': 'thinking a', 'llm-2': 'thinking b' },
      }),
    },
  })
  await user.click(screen.getByText('runLog.result'))
  expect(screen.getAllByText(/common.chat.thinking/)).toHaveLength(1)
  expect(screen.getByText('thinking a')).toBeInTheDocument()
  expect(screen.getByText('thinking b')).toBeInTheDocument()
  act(() =>
    store.setState({
      workflowRunningData: { ...store.getState().workflowRunningData!, resultText: 'The answer' },
    }),
  )
  expect(await screen.findByText(/common.chat.thought/)).toBeInTheDocument()
  expect(screen.queryByText(/common.chat.thinking/)).not.toBeInTheDocument()
  expect(screen.getByText('The answer')).toBeInTheDocument()
})

it('opens the trace from the partial-success warning', async () => {
  const user = userEvent.setup()
  renderPreview({
    initialStoreState: {
      workflowRunningData: createPreviewRunningData({
        result: createWorkflowResult({ status: 'partial-succeeded', exceptions_count: 1 }),
        tracing: [createNodeTracing({ title: 'Recoverable error' })],
        resultText: 'Ready',
      }),
    },
  })
  await user.click(screen.getByText('runLog.detail'))
  await user.click(screen.getByRole('link', { name: /TRACING/ }))
  expect(screen.getByText('Recoverable error')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /TRACING/ })).not.toBeInTheDocument()
})

it('loads nested tool traces using the editor app identity and preview run ID', async () => {
  const user = userEvent.setup()
  getChildExecutions.mockResolvedValue({ data: [] })
  renderPreview({
    resource: { kind: 'app', appId: 'preview-app', mode: 'workflow' },
    initialStoreState: {
      workflowRunningData: createPreviewRunningData({
        result: createWorkflowResult({
          id: 'preview-run',
          status: WorkflowRunningStatus.Succeeded,
        }),
        resultText: 'Completed',
        tracing: [
          createNodeTracing({
            id: 'preview-tool',
            node_type: BlockEnum.Tool,
            title: 'Nested workflow',
            status: 'succeeded',
            expand: true,
            extras: { workflow_tool: true },
          }),
        ],
      }),
    },
  })

  await user.click(await screen.findByRole('button', { name: 'runLog.tracing' }))
  expect(await screen.findByText('common.noData')).toBeInTheDocument()
  expect(getChildExecutions).toHaveBeenCalledWith({
    params: {
      app_id: 'preview-app',
      run_id: 'preview-run',
      node_execution_id: 'preview-tool',
    },
  })
})

it('shows the test run destination from its execution identity', async () => {
  const { queryClient } = createConsoleQueryWrapper()
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.traceRuns.bySourceKind.bySourceId.get.queryKey({
      input: { params: { app_id: 'app-1', source_kind: 'workflow', source_id: 'preview-run' } },
    }),
    {
      status: 'accepted',
      source_kind: 'workflow',
      source_id: 'preview-run',
      provider: 'langfuse',
      trace_url: 'https://traces.example.com/preview-run',
    },
  )
  renderPreview({
    queryClient,
    initialStoreState: {
      workflowRunningData: createPreviewRunningData({
        result: createWorkflowResult({
          id: 'preview-run',
          status: WorkflowRunningStatus.Succeeded,
        }),
      }),
    },
  })
  expect(await screen.findByRole('link', { name: 'app.tracing.run.viewTrace' })).toHaveAttribute(
    'href',
    'https://traces.example.com/preview-run',
  )
})
