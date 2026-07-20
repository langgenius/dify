import { render, screen } from '@testing-library/react'
import Header from '../index'

let mockWorkflowMode = {
  normal: true,
  restoring: false,
  viewHistory: false,
}

const dynamicMockState = vi.hoisted(() => ({
  calls: 0,
}))

function DynamicHeaderHistory(props: Record<string, unknown>) {
  return (
    <div data-testid="header-history" data-props={Object.keys(props).join(',')}>
      history-layout
    </div>
  )
}

function DynamicHeaderRestoring(props: Record<string, unknown>) {
  return (
    <div data-testid="header-restoring" data-props={Object.keys(props).join(',')}>
      restoring-layout
    </div>
  )
}

vi.mock('../../hooks', () => ({
  useWorkflowMode: () => mockWorkflowMode,
}))

vi.mock('@/next/dynamic', () => ({
  default: () => {
    dynamicMockState.calls += 1
    return dynamicMockState.calls === 1 ? DynamicHeaderHistory : DynamicHeaderRestoring
  },
}))

vi.mock('../header-in-normal', () => ({
  default: () => <div data-testid="header-normal">normal-layout</div>,
}))

vi.mock('../header-in-view-history', () => ({
  default: () => <div data-testid="header-history">history-layout</div>,
}))

vi.mock('../header-in-restoring', () => ({
  default: () => <div data-testid="header-restoring">restoring-layout</div>,
}))

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dynamicMockState.calls = 0
    mockWorkflowMode = {
      normal: true,
      restoring: false,
      viewHistory: false,
    }
  })

  it('should render the normal layout', () => {
    render(<Header />)

    expect(screen.getByTestId('header-normal')).toBeInTheDocument()
    expect(screen.queryByTestId('header-history')).not.toBeInTheDocument()
    expect(screen.queryByTestId('header-restoring')).not.toBeInTheDocument()
  })

  it('should switch between history and restoring layouts', async () => {
    mockWorkflowMode = {
      normal: false,
      restoring: true,
      viewHistory: true,
    }

    render(<Header />)

    expect(await screen.findByTestId('header-history')).toBeInTheDocument()
    expect(await screen.findByTestId('header-restoring')).toBeInTheDocument()
    expect(screen.queryByTestId('header-normal')).not.toBeInTheDocument()
  })
})
