import type {
  WorkflowRunDetailResponse,
  WorkflowRunNodeExecutionListResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { TestResultCard as TestResultPayload } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { DifyBuilderRuntime } from '../store'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { MarkdownProps } from '@/app/components/base/markdown'
import type { NodeTracing } from '@/types/workflow'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { DifyBuilderConversation } from '../conversation'
import { TestResultCard } from '../conversation/test-result-card'
import { difyBuilderRuntimeAtom } from '../store'

const mocks = vi.hoisted(() => ({
  detail: vi.fn<(input: unknown) => Promise<WorkflowRunDetailResponse>>(),
  executions: vi.fn<(input: unknown) => Promise<WorkflowRunNodeExecutionListResponse>>(),
  files: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const run = actual.consoleQuery.apps.byAppId.workflowRuns.byRunId
  return {
    ...actual,
    consoleQuery: {
      apps: {
        byAppId: {
          workflowRuns: {
            byRunId: {
              get: {
                queryOptions: (options: Parameters<typeof run.get.queryOptions>[0]) => ({
                  ...run.get.queryOptions(options),
                  queryFn: () => mocks.detail(options?.input),
                }),
              },
              nodeExecutions: {
                get: {
                  queryOptions: (
                    options: Parameters<typeof run.nodeExecutions.get.queryOptions>[0],
                  ) => ({
                    ...run.nodeExecutions.get.queryOptions(options),
                    queryFn: () => mocks.executions(options?.input),
                  }),
                },
              },
            },
          },
        },
      },
    },
  }
})

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: MarkdownProps) => <p>{content}</p>,
}))

vi.mock('@/app/components/base/file-uploader', () => ({
  FileList: (props: {
    files: FileEntity[]
    showDeleteAction: boolean
    showDownloadAction: boolean
    canPreview: boolean
  }) => {
    mocks.files(props)
    return (
      <ul>
        {props.files.map((file) => (
          <li key={file.id}>{file.name}</li>
        ))}
      </ul>
    )
  },
}))

vi.mock('@/app/components/workflow/run/tracing-panel', () => ({
  default: ({ list }: { list: NodeTracing[] }) => (
    <ul>
      {list.map((node) => (
        <li key={node.id}>{node.title}</li>
      ))}
    </ul>
  ),
}))

const runtime: DifyBuilderRuntime = {
  appId: 'app-1',
  canEdit: true,
  enabled: true,
  getCanvasSnapshot: () => ({ nodes: [], edges: [], isChatflow: false }),
  setShowPanel: vi.fn(),
  session: {
    startFix: vi.fn(),
    startChecklistFix: vi.fn(),
    startBuild: vi.fn(),
    startEdit: vi.fn(),
    loadOlderConversation: vi.fn(),
    refresh: vi.fn(),
    restore: vi.fn(),
    runAction: vi.fn(),
    sendMessage: vi.fn(),
    updateModel: vi.fn(),
    reset: vi.fn(),
    getTrace: vi.fn(),
    onCanvasRefreshed: vi.fn(),
  },
}

const renderNativeResult = (payload: TestResultPayload) => {
  const store = createStore()
  store.set(difyBuilderRuntimeAtom, runtime)
  const queryClient = createConsoleQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <TestResultCard payload={payload} invalidated={false} />
      </Provider>
    </QueryClientProvider>,
  )
}

describe('Builder test results', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it.each(['succeeded', 'failed'] as const)(
    'shows the final output immediately after a %s run',
    (status) => {
      const payload: TestResultPayload = {
        status,
        dify_run_id: 'run-1',
        terminal_outputs: { report: 'Processed three records.' },
        failure_reason: status === 'failed' ? 'The next step timed out.' : null,
      }
      render(<TestResultCard payload={payload} invalidated={false} />)

      const outputs = screen.getByRole('region', {
        name: 'difyBuilder.testResult.terminalOutputs',
      })
      expect(within(outputs).getByText('Processed three records.')).toBeVisible()
      if (status === 'failed') expect(screen.getByText('The next step timed out.')).toBeVisible()
      expect(
        screen.queryByRole('heading', {
          name:
            status === 'succeeded'
              ? 'difyBuilder.testResult.executionSucceeded'
              : 'difyBuilder.testResult.executionFailed',
        }),
      ).not.toBeInTheDocument()
      expect(screen.queryByText('difyBuilder.testResult.terminalOutputs')).not.toBeInTheDocument()
    },
  )

  it('preserves structured and falsy values directly in the visible result', () => {
    const terminal_outputs = {
      count: 0,
      enabled: false,
      missing: null,
      empty: '',
      items: [],
      settings: { locale: 'zh' },
    }
    render(<TestResultCard payload={{ status: 'failed', terminal_outputs }} invalidated={false} />)
    const outputs = screen.getByRole('region', {
      name: 'difyBuilder.testResult.terminalOutputs',
    })

    for (const value of ['0', 'false', 'null', '""', '[]'])
      expect(within(outputs).getByText(value, { exact: true })).toBeVisible()
    expect(within(outputs).getByText(/^\{\s*"locale": "zh"\s*\}$/)).toBeVisible()
    expect(screen.queryByText('difyBuilder.testResult.rawOutputs')).not.toBeInTheDocument()
  })

  it.each(['succeeded', 'failed'] as const)(
    'explains a known empty output for a %s run',
    (status) => {
      render(<TestResultCard payload={{ status, terminal_outputs: {} }} invalidated={false} />)
      const outputs = screen.getByRole('region', {
        name: 'difyBuilder.testResult.terminalOutputs',
      })
      expect(within(outputs).getByText('difyBuilder.testResult.noOutputs')).toBeVisible()
      expect(
        screen.queryByText('difyBuilder.testResult.outputsUnavailable'),
      ).not.toBeInTheDocument()
    },
  )

  it('explains that a failed launch without a run produced no final output', () => {
    render(
      <TestResultCard
        payload={{ status: 'failed', failure_reason: 'Launch failed.' }}
        invalidated={false}
      />,
    )
    expect(screen.getByText('difyBuilder.testResult.noOutputs')).toBeVisible()
    expect(screen.getByText('Launch failed.')).toBeVisible()
  })

  it('keeps the complete long text available without expanding a disclosure', () => {
    const report = `${'Review this paragraph.\n'.repeat(100)}Final conclusion.`
    render(
      <TestResultCard
        payload={{ status: 'succeeded', terminal_outputs: { report } }}
        invalidated={false}
      />,
    )
    const outputs = screen.getByRole('region', {
      name: 'difyBuilder.testResult.terminalOutputs',
    })
    expect(within(outputs).getByText(report, { normalizer: (text) => text })).toBeVisible()
  })

  it('renders output files with preview and download while retaining neighboring output fields', () => {
    const file = {
      dify_model_identity: '__dify__file__',
      related_id: 'file-1',
      extension: '.pdf',
      filename: 'report.pdf',
      size: 512,
      mime_type: 'application/pdf',
      transfer_method: 'local_file',
      type: 'document',
      url: '/files/file-1/file-preview?timestamp=1',
      upload_file_id: 'file-1',
      remote_url: '',
    }
    render(
      <TestResultCard
        payload={{
          status: 'failed',
          terminal_outputs: { report: '**Partial report**', files: [file] },
        }}
        invalidated={false}
      />,
    )

    expect(screen.getByText('**Partial report**')).toBeVisible()
    expect(screen.getByText('report.pdf')).toBeVisible()
    expect(mocks.files).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.objectContaining({ name: 'report.pdf', url: file.url })],
        canPreview: true,
        showDownloadAction: true,
        showDeleteAction: false,
      }),
    )
  })

  it.each(['succeeded', 'failed'] as const)(
    'loads missing final output from the specific native %s run',
    async (status) => {
      mocks.detail.mockResolvedValue({
        id: 'run-1',
        status,
        graph: {},
        inputs: {},
        outputs: { report: 'Native final result.' },
        error: status === 'failed' ? 'Native error.' : null,
      })
      renderNativeResult({ status, dify_run_id: 'run-1', terminal_outputs: null })

      expect(await screen.findByText('Native final result.')).toBeVisible()
      expect(mocks.detail).toHaveBeenCalledWith({ params: { app_id: 'app-1', run_id: 'run-1' } })
      if (status === 'failed') expect(screen.getByText('Native error.')).toBeVisible()
      expect(mocks.executions).not.toHaveBeenCalled()
    },
  )

  it('does not fetch a native result when the persisted card already contains the output', () => {
    renderNativeResult({
      status: 'failed',
      dify_run_id: 'run-1',
      terminal_outputs: { report: 'Saved result.' },
    })
    expect(screen.getByText('Saved result.')).toBeVisible()
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(mocks.executions).not.toHaveBeenCalled()
  })

  it('reads confirmed-tool outputs for display without writing native content into the card payload', async () => {
    const payload: TestResultPayload = {
      status: 'succeeded',
      dify_run_id: 'run-confirmed',
      execution_mode: 'confirmed_tool',
      terminal_outputs: null,
    }
    mocks.detail.mockResolvedValue({
      id: 'run-confirmed',
      graph: {},
      inputs: {},
      outputs: { report: 'Authorized run content.' },
    })
    renderNativeResult(payload)

    expect(await screen.findByText('Authorized run content.')).toBeVisible()
    expect(payload.terminal_outputs).toBeNull()
  })

  it('distinguishes unavailable results from empty results and allows retrying the read', async () => {
    const user = userEvent.setup()
    mocks.detail.mockRejectedValueOnce(new Error('Read failed.'))
    mocks.detail.mockResolvedValueOnce({ id: 'run-1', graph: {}, inputs: {}, outputs: {} })
    renderNativeResult({ status: 'failed', dify_run_id: 'run-1' })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'difyBuilder.testResult.resultLoadFailed',
    )
    expect(screen.queryByText('difyBuilder.testResult.noOutputs')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(await screen.findByText('difyBuilder.testResult.noOutputs')).toBeVisible()
  })

  it('restores each historical card from its own run even when responses arrive out of order', async () => {
    let resolveOlder!: (detail: WorkflowRunDetailResponse) => void
    mocks.detail.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOlder = resolve
      }),
    )
    mocks.detail.mockResolvedValueOnce({
      id: 'run-newer',
      graph: {},
      inputs: {},
      outputs: { report: 'Newer result.' },
    })
    const store = createStore()
    store.set(difyBuilderRuntimeAtom, runtime)
    render(
      <QueryClientProvider client={createConsoleQueryClient()}>
        <Provider store={store}>
          <DifyBuilderConversation
            busy={false}
            interrupted={false}
            items={[
              {
                seq: 0,
                at_version: 1,
                kind: 'test_result',
                payload: { status: 'failed', dify_run_id: 'run-older' },
              },
              {
                seq: 1,
                at_version: 2,
                kind: 'test_result',
                payload: { status: 'succeeded', dify_run_id: 'run-newer' },
              },
            ]}
          />
        </Provider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Newer result.')).toBeVisible()
    await act(async () =>
      resolveOlder({
        id: 'run-older',
        graph: {},
        inputs: {},
        outputs: { report: 'Older result.' },
      }),
    )

    const cards = screen.getAllByRole('article', { name: 'difyBuilder.cardCategory.test' })
    expect(await within(cards[0]!).findByText('Older result.')).toBeVisible()
    expect(within(cards[0]!).queryByText('Newer result.')).not.toBeInTheDocument()
    expect(within(cards[1]!).getByText('Newer result.')).toBeVisible()
  })

  it('loads native node details only when the user opens the matching run disclosure', async () => {
    const user = userEvent.setup()
    mocks.executions.mockResolvedValue({
      data: [
        {
          id: 'node-execution-1',
          node_id: 'node-1',
          title: 'Failed HTTP request',
          status: 'failed',
        },
      ],
    })
    renderNativeResult({ status: 'failed', dify_run_id: 'run-1', terminal_outputs: {} })

    const trigger = screen.getByRole('button', {
      name: 'difyBuilder.testResult.runDetails',
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(mocks.executions).not.toHaveBeenCalled()
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('Failed HTTP request')).toBeVisible()
    expect(mocks.executions).toHaveBeenCalledWith({ params: { app_id: 'app-1', run_id: 'run-1' } })
  })
})
