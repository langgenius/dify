import type { WorkflowRunDetailResponse } from '@/models/log'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastContext } from '@/app/components/base/toast'
import Run from './index'

type MockGenerationItem = {
  id: string
  toolName?: string
  thoughtOutput?: string
  text?: string
}

type MockFileGroup = {
  varName: string
}

const fetchRunDetailMock = vi.fn()
const fetchTracingListMock = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

vi.mock('@/service/log', () => ({
  fetchRunDetail: (...args: unknown[]) => fetchRunDetailMock(...args),
  fetchTracingList: (...args: unknown[]) => fetchTracingListMock(...args),
}))

vi.mock('../store', () => ({
  useStore: (selector: (state: { isListening: boolean }) => unknown) => selector({ isListening: false }),
}))

vi.mock('./output-panel', () => ({
  default: () => <div data-testid="output-panel">output-panel</div>,
}))

vi.mock('./result-panel', () => ({
  default: () => <div data-testid="result-panel">result-panel</div>,
}))

vi.mock('./status', () => ({
  default: () => <div data-testid="status-panel">status-panel</div>,
}))

vi.mock('./tracing-panel', () => ({
  default: ({ list }: { list: unknown[] }) => <div data-testid="tracing-panel">{list.length}</div>,
}))

vi.mock('./result-text', () => ({
  default: ({
    outputs,
    llmGenerationItems,
    allFiles,
  }: {
    outputs?: string
    llmGenerationItems?: MockGenerationItem[]
    allFiles?: MockFileGroup[]
  }) => (
    <div
      data-testid="result-text"
      data-output={outputs || ''}
      data-item-count={llmGenerationItems?.length || 0}
      data-file-count={allFiles?.length || 0}
    >
      {outputs || ''}
      {(llmGenerationItems || []).map(item => (
        <div key={item.id}>{item.toolName || item.thoughtOutput || item.text}</div>
      ))}
      {(allFiles || []).map(item => (
        <div key={item.varName}>{item.varName}</div>
      ))}
    </div>
  ),
}))

const baseRunDetail: WorkflowRunDetailResponse = {
  id: 'run-1',
  version: 'draft',
  graph: {
    nodes: [],
    edges: [],
  },
  inputs: {},
  inputs_truncated: false,
  status: 'succeeded',
  outputs: {},
  outputs_truncated: false,
  total_steps: 1,
  created_by_role: 'account',
  created_by_account: {
    id: 'account-1',
    name: 'Tester',
    email: 'tester@example.com',
  },
  created_at: 1,
  finished_at: 2,
}

const renderRun = () => {
  const notify = vi.fn()

  render(
    <ToastContext.Provider value={{ notify, close: vi.fn() }}>
      <Run
        runDetailUrl="/apps/app-1/workflow-runs/run-1"
        tracingListUrl="/apps/app-1/workflow-runs/run-1/node-executions"
        useFirstRunResultView
      />
    </ToastContext.Provider>,
  )

  return { notify }
}

describe('Run history result replay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchTracingListMock.mockResolvedValue({ data: [] })
  })

  it('renders workflow history result from result_replay and copies structured content', async () => {
    fetchRunDetailMock.mockResolvedValue({
      ...baseRunDetail,
      result_replay: {
        text: 'I checked the workspace.',
        llm_generation_items: [
          {
            type: 'text',
            text: 'I checked the workspace.',
            text_completed: true,
          },
          {
            type: 'tool',
            tool_name: 'bash',
            tool_arguments: '{"command":"ls"}',
            tool_output: 'output/',
            tool_duration: 0.3,
          },
        ],
        files: [
          {
            var_name: 'files',
            files: [
              {
                related_id: 'file-1',
                extension: 'pdf',
                filename: 'report.pdf',
                size: 128,
                mime_type: 'application/pdf',
                transfer_method: 'local_file',
                type: 'document',
                url: 'https://example.com/report.pdf',
                upload_file_id: 'upload-file-1',
                remote_url: '',
              },
            ],
          },
        ],
      },
    })

    renderRun()

    await waitFor(() => expect(screen.getByTestId('result-text')).toBeInTheDocument())
    expect(screen.queryByTestId('output-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('result-text')).toHaveAttribute('data-output', 'I checked the workspace.')
    expect(screen.getByTestId('result-text')).toHaveAttribute('data-item-count', '2')
    expect(screen.getByTestId('result-text')).toHaveAttribute('data-file-count', '1')

    await userEvent.setup().click(screen.getByRole('button', { name: 'operation.copy' }))

    expect(copy).toHaveBeenCalledWith(
      expect.stringContaining('[TOOL] bash'),
    )
    expect(copy).toHaveBeenCalledWith(
      expect.stringContaining('INPUT:\n{"command":"ls"}'),
    )
  })

  it('falls back to generation outputs for old runs without result_replay', async () => {
    fetchRunDetailMock.mockResolvedValue({
      ...baseRunDetail,
      outputs_as_generation: true,
      outputs: {
        generation: {
          content: 'Hello',
          reasoning_content: ['Need to answer'],
          tool_calls: [
            {
              name: 'bash',
              arguments: '{"command":"pwd"}',
              result: '/workspace',
              elapsed_time: 0.2,
              status: 'success',
            },
          ],
          sequence: [
            { type: 'reasoning', index: 0 },
            { type: 'tool_call', index: 0 },
            { type: 'content', start: 0, end: 5 },
          ],
        },
      },
    })

    renderRun()

    await waitFor(() => expect(screen.getByTestId('result-text')).toBeInTheDocument())
    expect(screen.getByTestId('result-text')).toHaveAttribute('data-output', 'Hello')
    expect(screen.getByTestId('result-text')).toHaveAttribute('data-item-count', '3')
    expect(screen.getByText('Need to answer')).toBeInTheDocument()
    expect(screen.getByText('bash')).toBeInTheDocument()
  })

  it('synthesizes tool items for generation outputs without sequence and does not leak a zero placeholder', async () => {
    fetchRunDetailMock.mockResolvedValue({
      ...baseRunDetail,
      outputs_as_generation: true,
      outputs: {
        generation: {
          content: 'Workspace is clean.',
          reasoning_content: [],
          tool_calls: [
            {
              name: 'bash',
              arguments: '{"command":"ls"}',
              output: 'output/',
              elapsed_time: 0.2,
              status: 'success',
            },
          ],
          sequence: [],
        },
      },
    })

    renderRun()

    await waitFor(() => expect(screen.getByTestId('result-text')).toBeInTheDocument())
    expect(screen.getByTestId('result-text')).toHaveAttribute('data-output', 'Workspace is clean.')
    expect(screen.getByTestId('result-text')).toHaveAttribute('data-item-count', '2')
    expect(screen.getByText('bash')).toBeInTheDocument()
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument()
  })

  it('keeps default output-panel behavior when history replay mode is disabled', async () => {
    fetchRunDetailMock.mockResolvedValue({
      ...baseRunDetail,
      outputs: {
        answer: 'Hello',
      },
    })

    const notify = vi.fn()
    render(
      <ToastContext.Provider value={{ notify, close: vi.fn() }}>
        <Run
          runDetailUrl="/apps/app-1/workflow-runs/run-1"
          tracingListUrl="/apps/app-1/workflow-runs/run-1/node-executions"
        />
      </ToastContext.Provider>,
    )

    await waitFor(() => expect(screen.getByTestId('output-panel')).toBeInTheDocument())
    expect(screen.queryByTestId('result-text')).not.toBeInTheDocument()
  })
})
