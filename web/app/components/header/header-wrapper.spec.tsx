import { act, render, screen } from '@testing-library/react'
import { usePathname } from 'next/navigation'
import { vi } from 'vitest'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import HeaderWrapper from './header-wrapper'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: vi.fn(),
}))

describe('HeaderWrapper', () => {
  type CanvasEvent = { type: string, payload: boolean }
  let subscriptionCallback: ((event: CanvasEvent) => void) | null = null
  const mockUseSubscription = vi.fn<(callback: (event: CanvasEvent) => void) => void>((callback) => {
    subscriptionCallback = callback
  })

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    subscriptionCallback = null
    vi.mocked(usePathname).mockReturnValue('/test')
    vi.mocked(useEventEmitterContextContext).mockReturnValue({
      eventEmitter: { useSubscription: mockUseSubscription },
    } as never)
  })

  it('should render children correctly', () => {
    render(
      <HeaderWrapper>
        <div data-testid="child">Test Child</div>
      </HeaderWrapper>,
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.getByText('Test Child')).toBeInTheDocument()
  })

  it('should keep children mounted when workflow maximize events are emitted', () => {
    vi.mocked(usePathname).mockReturnValue('/some/path/workflow')
    render(
      <HeaderWrapper>
        <div>Workflow Content</div>
      </HeaderWrapper>,
    )

    act(() => {
      subscriptionCallback?.({ type: 'workflow-canvas-maximize', payload: true })
      subscriptionCallback?.({ type: 'workflow-canvas-maximize', payload: false })
    })

    expect(screen.getByText('Workflow Content')).toBeInTheDocument()
  })

  it('should keep children mounted on pipeline routes when maximize is enabled from storage', () => {
    vi.mocked(usePathname).mockReturnValue('/some/path/pipeline')
    localStorage.setItem('workflow-canvas-maximize', 'true')

    render(
      <HeaderWrapper>
        <div>Pipeline Content</div>
      </HeaderWrapper>,
    )

    expect(screen.getByText('Pipeline Content')).toBeInTheDocument()
  })

  it('should keep children mounted on non-canvas routes when maximize is enabled from storage', () => {
    vi.mocked(usePathname).mockReturnValue('/apps')
    localStorage.setItem('workflow-canvas-maximize', 'true')

    render(
      <HeaderWrapper>
        <div>App Content</div>
      </HeaderWrapper>,
    )

    expect(screen.getByText('App Content')).toBeInTheDocument()
  })

  it('should keep children mounted when unrelated events are emitted', () => {
    vi.mocked(usePathname).mockReturnValue('/some/path/workflow')
    render(
      <HeaderWrapper>
        <div>Workflow Content</div>
      </HeaderWrapper>,
    )

    act(() => {
      subscriptionCallback?.({ type: 'other-event', payload: true })
    })

    expect(screen.getByText('Workflow Content')).toBeInTheDocument()
  })

  it('should render children when eventEmitter is unavailable', () => {
    vi.mocked(useEventEmitterContextContext).mockReturnValue({
      eventEmitter: undefined,
    } as never)

    render(
      <HeaderWrapper>
        <div>Content Without Emitter</div>
      </HeaderWrapper>,
    )

    expect(screen.getByText('Content Without Emitter')).toBeInTheDocument()
  })
})
