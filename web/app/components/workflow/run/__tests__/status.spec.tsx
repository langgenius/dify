import type { WorkflowPauseDetailsResponse } from '@dify/contracts/api/console/workflow/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { cloneElement, isValidElement } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDocLinkMock, resolveDocLink } from '../../__tests__/i18n'
import Status from '../status'

const releaseGate = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_HITL_IM() {
    return releaseGate.enabled
  },
}))

const mockDocLink = createDocLinkMock()
const mockPauseDetails = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', async () => {
  const { withSelectorKey, withSelectorKeyProps } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string, options?: Record<string, unknown>) => {
        const fullKey = options?.ns ? `${options.ns}.${key}` : key
        if (fullKey === 'workflow.nodes.common.errorHandle.partialSucceeded.tip')
          return 'There are {{num}} nodes in the process running abnormally, please go to TRACING to check the logs.'

        const params = { ...options }
        delete params.ns
        const suffix = Object.keys(params).length > 0 ? `:${JSON.stringify(params)}` : ''
        return `${fullKey}${suffix}`
      }),
    }),
    Trans: withSelectorKeyProps(
      ({
        i18nKey,
        values,
        components,
      }: {
        i18nKey: string
        values?: {
          num?: string | number
        }
        components?: Record<string, React.ReactNode>
      }) => {
        if (i18nKey !== 'nodes.common.errorHandle.partialSucceeded.tip')
          return <span>{i18nKey}</span>

        const tracingLink = components?.tracingLink
        const tracingNode = isValidElement(tracingLink)
          ? cloneElement(tracingLink, undefined, 'TRACING')
          : 'TRACING'

        return (
          <span>
            There are {values?.num} nodes in the process running abnormally, please go to{' '}
            {tracingNode} to check the logs.
          </span>
        )
      },
    ),
  }
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => mockDocLink,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workflow.byWorkflowRunId.pauseDetails.get': (input) => mockPauseDetails(input),
    }),
  }
})

vi.mock('@/utils/var', () => ({
  basePath: '/dify',
}))

const createPausedDetails = (
  overrides: Partial<WorkflowPauseDetailsResponse> = {},
): WorkflowPauseDetailsResponse => ({
  paused_at: '2026-03-18T00:00:00Z',
  paused_nodes: [],
  ...overrides,
})

describe('Status', () => {
  beforeEach(() => {
    releaseGate.enabled = true
    vi.resetAllMocks()
    mockPauseDetails.mockImplementation(() => new Promise(() => {}))
  })

  it('renders the scheduled status before execution', () => {
    render(<Status status="scheduled" />)

    expect(screen.getByRole('status')).toHaveTextContent('appLog.status.scheduled')
  })

  it('renders the running status and loading placeholders', () => {
    render(<Status status="running" workflowRunId="run-1" />)

    expect(screen.getByText('appLog.status.running')).toBeInTheDocument()
    expect(mockPauseDetails).not.toHaveBeenCalled()
  })

  it('renders the listening label when the run is waiting for input', () => {
    render(<Status status="running" isListening workflowRunId="run-2" />)

    expect(screen.getByText('workflow.common.listening')).toBeInTheDocument()
  })

  it('renders succeeded metadata values', () => {
    render(<Status status="succeeded" time={1.234} tokens={8} />)

    expect(screen.getByRole('status')).toHaveTextContent('appLog.status.succeeded')
    expect(screen.getByText('1.234s')).toBeInTheDocument()
    expect(screen.getByText('8 Tokens')).toBeInTheDocument()
  })

  it('renders stopped fallbacks when time and tokens are missing', () => {
    render(<Status status="stopped" />)

    expect(screen.getByText('appLog.status.stopped')).toBeInTheDocument()
    expect(screen.getByText('-')).toBeInTheDocument()
    expect(screen.getByText('0 Tokens')).toBeInTheDocument()
  })

  it('renders failed details and the partial-success exception tip', () => {
    render(<Status status="failed" error="Something broke" exceptionCounts={2} />)

    expect(screen.getByText('appLog.status.failed')).toBeInTheDocument()
    expect(screen.getByText('Something broke')).toBeInTheDocument()
    expect(
      screen.getAllByText(
        (_, element) =>
          element?.textContent ===
          'There are 2 nodes in the process running abnormally, please go to TRACING to check the logs.',
      ),
    ).toHaveLength(2)
  })

  it('renders the partial-succeeded warning summary', () => {
    render(<Status status="partial-succeeded" exceptionCounts={3} />)

    expect(screen.getByText('appLog.status.partial-succeeded')).toBeInTheDocument()
    expect(
      screen.getAllByText(
        (_, element) =>
          element?.textContent ===
          'There are 3 nodes in the process running abnormally, please go to TRACING to check the logs.',
      ),
    ).toHaveLength(2)
  })

  it('opens the tracing tab when clicking the TRACING link', async () => {
    const user = userEvent.setup()
    const onOpenTracingTab = vi.fn()

    render(
      <Status status="partial-succeeded" exceptionCounts={3} onOpenTracingTab={onOpenTracingTab} />,
    )

    await user.click(screen.getByRole('link', { name: 'TRACING' }))

    expect(onOpenTracingTab).toHaveBeenCalledTimes(1)
  })

  it('renders the exception learn-more link', () => {
    render(<Status status="exception" error="Bad request" />)

    const learnMoreLink = screen.getByRole('link', { name: 'workflow.common.learnMore' })

    expect(screen.getByText('workflow.tracing.status.exception')).toBeInTheDocument()
    expect(learnMoreLink).toHaveAttribute('href', resolveDocLink('/use-dify/debug/error-type'))
  })

  it('requests pause details only for the paused run', async () => {
    render(<Status status="paused" workflowRunId="run-3" />)

    expect(screen.getByText('appLog.status.paused')).toBeInTheDocument()
    expect(screen.getByText('workflowHumanInput.nodes.humanInput.log.reason')).toBeInTheDocument()
    await waitFor(() =>
      expect(mockPauseDetails).toHaveBeenCalledWith({ params: { workflow_run_id: 'run-3' } }),
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders paused human-input reasons and backstage URLs', async () => {
    mockPauseDetails.mockResolvedValue(
      createPausedDetails({
        paused_nodes: [
          {
            node_id: 'node-1',
            node_title: 'Need review',
            pause_type: {
              type: 'human_input',
              form_id: 'form-1',
              form_version: '1',
              backstage_input_url: 'https://example.com/form/legacy-token',
            },
          },
          {
            node_id: 'node-2',
            node_title: 'Need review 2',
            pause_type: {
              type: 'human_input',
              form_id: 'form-2',
              form_version: '2',
              backstage_input_url: 'https://example.com/form/console-token',
            },
          },
        ],
      }),
    )

    render(<Status status="paused" workflowRunId="run-4" />)
    await screen.findByRole('link', { name: 'https://example.com/form/legacy-token' })

    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.log.reasonContent'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('workflowHumanInput.nodes.humanInput.log.backstageInputURL'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'https://example.com/form/legacy-token' }),
    ).toHaveAttribute('href', 'https://example.com/form/legacy-token')
    expect(screen.getByRole('link', { name: '/dify/human-input/console-token' })).toHaveAttribute(
      'href',
      '/dify/human-input/console-token',
    )
  })

  it.each<{ formVersion?: '1' | '2'; backstageURL: string; destination: string }>([
    {
      formVersion: '1',
      backstageURL: 'https://webapp.example.com/form/legacy-token',
      destination: 'https://webapp.example.com/form/legacy-token',
    },
    {
      backstageURL: '/dify/form/legacy-token?source=run',
      destination: '/dify/form/legacy-token?source=run',
    },
    {
      formVersion: '2',
      backstageURL: 'https://webapp.example.com/form/console-token',
      destination: '/dify/human-input/console-token',
    },
    {
      formVersion: '2',
      backstageURL: 'https://webapp.example.com/dify/form/approval%2Btoken/',
      destination: '/dify/human-input/approval%2Btoken',
    },
    {
      formVersion: '2',
      backstageURL: '/form/console-token',
      destination: '/dify/human-input/console-token',
    },
    {
      formVersion: '2',
      backstageURL: 'https://webapp.example.com/form-v2/v2-token',
      destination: 'https://webapp.example.com/form-v2/v2-token',
    },
  ])(
    'opens the appropriate approval surface for $formVersion $backstageURL',
    async ({ formVersion, backstageURL, destination }) => {
      mockPauseDetails.mockResolvedValue(
        createPausedDetails({
          paused_nodes: [
            {
              node_id: 'review-node',
              node_title: 'Need review',
              pause_type: {
                type: 'human_input',
                form_id: 'review-form',
                form_version: formVersion,
                backstage_input_url: backstageURL,
              },
            },
          ],
        }),
      )

      render(<Status status="paused" workflowRunId="paused-run" />)

      expect(await screen.findByRole('link', { name: destination })).toHaveAttribute(
        'href',
        destination,
      )
    },
  )
  it('keeps legacy links but disables V2 approval links when the release gate is off', async () => {
    releaseGate.enabled = false
    mockPauseDetails.mockResolvedValue(
      createPausedDetails({
        paused_nodes: [
          {
            node_id: 'v1',
            node_title: 'Legacy',
            pause_type: {
              type: 'human_input',
              form_id: 'legacy',
              form_version: '1',
              backstage_input_url: 'https://example.com/form/legacy',
            },
          },
          {
            node_id: 'v2',
            node_title: 'V2',
            pause_type: {
              type: 'human_input',
              form_id: 'new',
              form_version: '2',
              backstage_input_url: 'https://example.com/form/v2-token',
            },
          },
        ],
      }),
    )
    render(<Status status="paused" workflowRunId="run" />)
    expect(
      await screen.findByRole('link', { name: 'https://example.com/form/legacy' }),
    ).toHaveAttribute('href', 'https://example.com/form/legacy')
    expect(screen.getByText('share.humanInputV2.unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /v2-token/ })).not.toBeInTheDocument()
  })
})
