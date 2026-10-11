import type { ComponentProps } from 'react'
import type { Shape } from '../../store/workflow'
import type { HumanInputFilledFormData, HumanInputFormData } from '@/types/workflow'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createNodeTracing,
  createStartNode,
  createWorkflowRunningData,
} from '@/app/components/workflow/__tests__/fixtures'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { BlockEnum, InputVarType, WorkflowRunningStatus } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'

const mockWriteText = vi.fn()
import { submitHumanInputForm } from '@/service/workflow'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import WorkflowPreview from '../workflow-preview'

const getChildExecutions = vi.hoisted(() =>
  vi.fn<
    typeof import('@/service/console').consoleClient.apps.byAppId.workflowRuns.byRunId.nodeExecutions.byNodeExecutionId.children.get
  >(),
)
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflowRuns.byRunId.nodeExecutions.byNodeExecutionId.children.get':
        getChildExecutions,
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

beforeEach(() => {
  getChildExecutions.mockReset()
  mockSubmitHumanInputForm.mockReset().mockResolvedValue({ result: 'success' })
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
})

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
  mockWriteText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWriteText },
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.copy' }))
  expect(mockWriteText).toHaveBeenCalledWith('final answer')
  expect(
    await screen.findByRole('button', { name: 'common.operation.copied' }),
  ).toBeInTheDocument()
  expect(toast.success).not.toHaveBeenCalledWith('common.actionMsg.copySuccessfully')
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
