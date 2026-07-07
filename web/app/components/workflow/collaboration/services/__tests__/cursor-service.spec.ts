import type { ReactFlowInstance } from 'reactflow'
import { CursorService } from '../cursor-service'

describe('CursorService', () => {
  let service: CursorService
  let container: HTMLDivElement
  let now = 0

  beforeEach(() => {
    service = new CursorService()
    container = document.createElement('div')
    document.body.appendChild(container)
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      right: 410,
      bottom: 220,
      width: 400,
      height: 200,
      toJSON: () => ({}),
    } as DOMRect)
    now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    container.remove()
  })

  it('emits transformed positions with throttle and distance guard', () => {
    const onEmit = vi.fn()
    const reactFlow = {
      getViewport: () => ({ x: 5, y: 10, zoom: 2 }),
      getZoom: () => 2,
    } as unknown as ReactFlowInstance

    service.startTracking({ current: container }, onEmit, reactFlow)

    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 50 }))
    expect(onEmit).toHaveBeenCalledTimes(1)
    expect(onEmit).toHaveBeenLastCalledWith(expect.objectContaining({
      x: 7.5,
      y: 10,
      timestamp: 1000,
    }))

    now = 1100
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 60 }))
    expect(onEmit).toHaveBeenCalledTimes(1)

    now = 1401
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 33, clientY: 53 }))
    expect(onEmit).toHaveBeenCalledTimes(1)

    now = 1800
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 90 }))
    expect(onEmit).toHaveBeenCalledTimes(2)
    expect(onEmit).toHaveBeenLastCalledWith(expect.objectContaining({
      x: 22.5,
      y: 30,
      timestamp: 1800,
    }))
  })

  it('stops tracking and forwards cursor updates to registered handler', () => {
    const onEmit = vi.fn()
    const onCursorUpdate = vi.fn()
    service.startTracking({ current: container }, onEmit)
    service.setCursorUpdateHandler(onCursorUpdate)

    service.updateCursors({
      u1: { x: 1, y: 2, userId: 'u1', timestamp: 1 },
    })
    expect(onCursorUpdate).toHaveBeenCalledWith({
      u1: { x: 1, y: 2, userId: 'u1', timestamp: 1 },
    })

    service.stopTracking()
    now = 2000
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 60 }))
    expect(onEmit).not.toHaveBeenCalled()
  })
})
