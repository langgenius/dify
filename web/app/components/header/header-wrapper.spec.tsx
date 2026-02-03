import { act, render, screen } from '@testing-library/react'
import { usePathname } from 'next/navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import HeaderWrapper from './header-wrapper'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: vi.fn(),
}))

describe('HeaderWrapper', () => {
  let mockEventEmitter: { useSubscription: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue('/apps')
    mockEventEmitter = {
      useSubscription: vi.fn(),
    }
    vi.mocked(useEventEmitterContextContext).mockReturnValue({ eventEmitter: mockEventEmitter } as unknown as ReturnType<typeof useEventEmitterContextContext>)
    localStorage.clear()
  })

  it('renders children and has sticky classes', () => {
    render(<HeaderWrapper><div>Child</div></HeaderWrapper>)
    expect(screen.getByText('Child')).toBeDefined()
    const element = screen.getByText('Child').parentElement
    expect(element?.className).toContain('sticky')
  })

  it('adds border-b when on bordered routes', () => {
    vi.mocked(usePathname).mockReturnValue('/apps')
    const { container } = render(<HeaderWrapper><div>Child</div></HeaderWrapper>)
    expect(container.firstChild).toHaveClass('border-b')
  })

  it('does not have border-b on non-bordered routes', () => {
    vi.mocked(usePathname).mockReturnValue('/other')
    const { container } = render(<HeaderWrapper><div>Child</div></HeaderWrapper>)
    expect(container.firstChild).not.toHaveClass('border-b')
  })

  it('hides header when maximized in workflow', () => {
    vi.mocked(usePathname).mockReturnValue('/app/1/workflow')
    localStorage.setItem('workflow-canvas-maximize', 'true')
    const { container } = render(<HeaderWrapper><div>Child</div></HeaderWrapper>)
    expect(container.firstChild).toHaveClass('hidden')
  })

  it('updates hidden state via event emitter', () => {
    vi.mocked(usePathname).mockReturnValue('/app/1/workflow')
    let subscriptionCallback: (v: { type: string, payload: boolean }) => void
    mockEventEmitter.useSubscription.mockImplementation((cb: (v: { type: string, payload: boolean }) => void) => {
      subscriptionCallback = cb
    })

    const { container } = render(<HeaderWrapper><div>Child</div></HeaderWrapper>)
    expect(container.firstChild).not.toHaveClass('hidden')

    act(() => {
      subscriptionCallback({ type: 'workflow-canvas-maximize', payload: true })
    })

    expect(container.firstChild).toHaveClass('hidden')

    act(() => {
      subscriptionCallback({ type: 'workflow-canvas-maximize', payload: false })
    })
    expect(container.firstChild).not.toHaveClass('hidden')
  })
})
