import { render, screen } from '@testing-library/react'
import Meta from '../meta'

const mockFormatTime = vi.fn((value: number) => `formatted:${value}`)

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: mockFormatTime,
  }),
}))

describe('Meta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading placeholders while the run is in progress', () => {
    const { container } = render(<Meta status="running" />)

    expect(container.querySelectorAll('.bg-text-quaternary')).toHaveLength(6)
    expect(screen.queryByText('SUCCESS')).not.toBeInTheDocument()
    expect(screen.queryByText('runLog.meta.steps')).toBeInTheDocument()
  })

  it.each([
    ['succeeded', 'SUCCESS'],
    ['partial-succeeded', 'PARTIAL SUCCESS'],
    ['exception', 'EXCEPTION'],
    ['failed', 'FAIL'],
    ['stopped', 'STOP'],
    ['paused', 'PENDING'],
  ] as const)('renders the %s status label', (status, label) => {
    render(<Meta status={status} />)

    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('renders explicit metadata values and hides steps when requested', () => {
    render(
      <Meta
        status="succeeded"
        executor="Alice"
        startTime={1700000000000}
        time={1.2349}
        tokens={42}
        steps={3}
        showSteps={false}
      />,
    )

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('formatted:1700000000000')).toBeInTheDocument()
    expect(screen.getByText('1.235s')).toBeInTheDocument()
    expect(screen.getByText('42 Tokens')).toBeInTheDocument()
    expect(screen.queryByText('Run Steps')).not.toBeInTheDocument()
    expect(mockFormatTime).toHaveBeenCalledWith(1700000000000, expect.any(String))
  })

  it('falls back to default values when metadata is missing', () => {
    render(<Meta status="failed" />)

    expect(screen.getByText('N/A')).toBeInTheDocument()
    expect(screen.getAllByText('-')).toHaveLength(2)
    expect(screen.getByText('0 Tokens')).toBeInTheDocument()
    expect(screen.getByText('runLog.meta.steps').parentElement).toHaveTextContent('1')
    expect(mockFormatTime).not.toHaveBeenCalled()
  })
})
