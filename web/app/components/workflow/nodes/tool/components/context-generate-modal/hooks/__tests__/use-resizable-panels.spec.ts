import { act, renderHook } from '@testing-library/react'
import useResizablePanels from '../use-resizable-panels'

const {
  mockUseEventListener,
  mockUseSize,
} = vi.hoisted(() => ({
  mockUseEventListener: vi.fn(),
  mockUseSize: vi.fn(),
}))

const listeners: Partial<Record<'mousemove' | 'mouseup', (event?: { clientY: number }) => void>> = {}

vi.mock('ahooks', async () => {
  const actual = await vi.importActual<typeof import('ahooks')>('ahooks')
  return {
    ...actual,
    useEventListener: (eventName: 'mousemove' | 'mouseup', handler: (event?: { clientY: number }) => void) => {
      listeners[eventName] = handler
      mockUseEventListener(eventName, handler)
    },
    useSize: (...args: unknown[]) => mockUseSize(...args),
  }
})

describe('useResizablePanels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.mousemove = undefined
    listeners.mouseup = undefined
    mockUseSize.mockReturnValue(undefined)
    document.body.style.userSelect = ''
  })

  it('should keep the default height until the container size is known', () => {
    const { result } = renderHook(() => useResizablePanels())

    expect(result.current.resolvedCodePanelHeight).toBe(556)
  })

  it('should clamp the panel height and handle drag interactions', () => {
    mockUseSize.mockReturnValue({ height: 400 })
    const { result, rerender } = renderHook(() => useResizablePanels())

    rerender()
    expect(result.current.resolvedCodePanelHeight).toBe(316)

    act(() => {
      ;(result.current.rightContainerRef as { current: { offsetHeight: number } | null }).current = { offsetHeight: 400 }
      result.current.handleResizeStart({ clientY: 100 } as React.PointerEvent<HTMLButtonElement>)
    })

    expect(document.body.style.userSelect).toBe('none')

    act(() => {
      listeners.mousemove?.({ clientY: 40 })
    })

    expect(result.current.resolvedCodePanelHeight).toBe(256)

    act(() => {
      listeners.mousemove?.({ clientY: -200 })
    })

    expect(result.current.resolvedCodePanelHeight).toBe(80)

    act(() => {
      listeners.mouseup?.()
    })

    expect(document.body.style.userSelect).toBe('')
  })

  it('should ignore move and mouseup events when dragging has not started', () => {
    mockUseSize.mockReturnValue({ height: 400 })
    const { result } = renderHook(() => useResizablePanels())

    act(() => {
      listeners.mousemove?.({ clientY: 180 })
      listeners.mouseup?.()
    })

    expect(result.current.resolvedCodePanelHeight).toBe(316)
    expect(document.body.style.userSelect).toBe('')
  })

  it('should ignore mouse moves when the container height is unavailable', () => {
    mockUseSize.mockReturnValue({ height: 400 })
    const { result } = renderHook(() => useResizablePanels())

    act(() => {
      result.current.handleResizeStart({ clientY: 100 } as React.PointerEvent<HTMLButtonElement>)
      listeners.mousemove?.({ clientY: 200 })
    })

    expect(result.current.resolvedCodePanelHeight).toBe(316)
    expect(document.body.style.userSelect).toBe('none')
  })
})
