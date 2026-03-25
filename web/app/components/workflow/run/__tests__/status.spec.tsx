import type { WorkflowPausedDetailsResponse } from '@/models/log'
import { render, screen } from '@testing-library/react'
import { createDocLinkMock, resolveDocLink } from '../../__tests__/i18n'
import Status from '../status'

const mockDocLink = createDocLinkMock()
const mockUseWorkflowPausedDetails = vi.fn()

vi.mock('@/context/i18n', () => ({
  useDocLink: () => mockDocLink,
}))

vi.mock('@/service/use-log', () => ({
  useWorkflowPausedDetails: (params: { workflowRunId: string, enabled?: boolean }) => mockUseWorkflowPausedDetails(params),
}))

const createPausedDetails = (overrides: Partial<WorkflowPausedDetailsResponse> = {}): WorkflowPausedDetailsResponse => ({
  paused_at: '2026-03-18T00:00:00Z',
  paused_nodes: [],
  ...overrides,
})

describe('Status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseWorkflowPausedDetails.mockReturnValue({ data: undefined })
  })

  it('renders the running status and loading placeholders', () => {
    render(<Status status="running" workflowRunId="run-1" />)

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(document.querySelectorAll('.bg-text-quaternary')).toHaveLength(2)
    expect(mockUseWorkflowPausedDetails).toHaveBeenCalledWith({
      workflowRunId: 'run-1',
      enabled: false,
    })
  })

  it('renders the listening label when the run is waiting for input', () => {
    render(<Status status="running" isListening workflowRunId="run-2" />)

    expect(screen.getByText('Listening')).toBeInTheDocument()
  })

  it('renders succeeded metadata values', () => {
    render(<Status status="succeeded" time={1.234} tokens={8} />)

    expect(screen.getByText('SUCCESS')).toBeInTheDocument()
    expect(screen.getByText('1.234s')).toBeInTheDocument()
    expect(screen.getByText('8 Tokens')).toBeInTheDocument()
  })

  it('renders stopped fallbacks when time and tokens are missing', () => {
    render(<Status status="stopped" />)

    expect(screen.getByText('STOP')).toBeInTheDocument()
    expect(screen.getByText('-')).toBeInTheDocument()
    expect(screen.getByText('0 Tokens')).toBeInTheDocument()
  })

  it('renders failed details and the partial-success exception tip', () => {
    render(<Status status="failed" error="Something broke" exceptionCounts={2} />)

    expect(screen.getByText('FAIL')).toBeInTheDocument()
    expect(screen.getByText('Something broke')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.common.errorHandle.partialSucceeded.tip:{"num":2}')).toBeInTheDocument()
  })

  it('renders the partial-succeeded warning summary', () => {
    render(<Status status="partial-succeeded" exceptionCounts={3} />)

    expect(screen.getByText('PARTIAL SUCCESS')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.common.errorHandle.partialSucceeded.tip:{"num":3}')).toBeInTheDocument()
  })

  it('renders the exception learn-more link', () => {
    render(<Status status="exception" error="Bad request" />)

    const learnMoreLink = screen.getByRole('link', { name: 'workflow.common.learnMore' })

    expect(screen.getByText('EXCEPTION')).toBeInTheDocument()
    expect(learnMoreLink).toHaveAttribute('href', resolveDocLink('/use-dify/debug/error-type'))
    expect(mockDocLink).toHaveBeenCalledWith('/use-dify/debug/error-type')
  })

  it('renders paused placeholders when pause details have not loaded yet', () => {
    render(<Status status="paused" workflowRunId="run-3" />)

    expect(screen.getByText('PENDING')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.humanInput.log.reason')).toBeInTheDocument()
    expect(document.querySelectorAll('.bg-text-quaternary')).toHaveLength(3)
    expect(mockUseWorkflowPausedDetails).toHaveBeenCalledWith({
      workflowRunId: 'run-3',
      enabled: true,
    })
  })

  it('renders paused human-input reasons and backstage URLs', () => {
    mockUseWorkflowPausedDetails.mockReturnValue({
      data: createPausedDetails({
        paused_nodes: [
          {
            node_id: 'node-1',
            node_title: 'Need review',
            pause_type: {
              type: 'human_input',
              form_id: 'form-1',
              backstage_input_url: 'https://example.com/a',
            },
          },
          {
            node_id: 'node-2',
            node_title: 'Need review 2',
            pause_type: {
              type: 'human_input',
              form_id: 'form-2',
              backstage_input_url: 'https://example.com/b',
            },
          },
        ],
      }),
    })

    render(<Status status="paused" workflowRunId="run-4" />)

    expect(screen.getByText('workflow.nodes.humanInput.log.reasonContent')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.humanInput.log.backstageInputURL')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://example.com/a' })).toHaveAttribute('href', 'https://example.com/a')
    expect(screen.getByRole('link', { name: 'https://example.com/b' })).toHaveAttribute('href', 'https://example.com/b')
  })
})
