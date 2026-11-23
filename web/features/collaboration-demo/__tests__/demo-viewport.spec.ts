import { demoGraphBounds } from '../demo-graph'
import { getDemoViewport } from '../demo-viewport'
import { demoCommentPosition } from '../playback-script'

const toScreen = (
  viewport: ReturnType<typeof getDemoViewport>,
  point: { x: number; y: number },
) => ({
  x: point.x * viewport.zoom + viewport.x,
  y: point.y * viewport.zoom + viewport.y,
})

describe('getDemoViewport', () => {
  it.each([
    [1376, 900],
    [1216, 800],
    [1024, 768],
  ])('leaves room for the thread beside its marker on a %ix%i canvas', (width, height) => {
    const viewport = getDemoViewport(width, height)
    const pin = toScreen(viewport, demoCommentPosition)
    const graphBottom = toScreen(viewport, {
      x: demoGraphBounds.x,
      y: demoGraphBounds.y + demoGraphBounds.height,
    }).y

    // A two-avatar marker is 47px wide and the design puts the 360px thread 17px beside it.
    expect(pin.x + 47 + 17 + 360).toBeLessThanOrEqual(width - 8)
    expect(graphBottom).toBeLessThanOrEqual(height)
  })

  it.each([
    [800, 600],
    [704, 900],
  ])('keeps the whole flow and the comment marker on a %ix%i canvas', (width, height) => {
    const viewport = getDemoViewport(width, height)
    const pin = toScreen(viewport, demoCommentPosition)
    const left = toScreen(viewport, demoGraphBounds).x

    expect(left).toBeGreaterThanOrEqual(56)
    expect(pin.x + 47).toBeLessThanOrEqual(width - 8)
  })

  it('keeps the flow clear of the end-side toolbar in RTL', () => {
    const viewport = getDemoViewport(1376, 900, 'rtl')
    const pin = toScreen(viewport, demoCommentPosition)
    const left = toScreen(viewport, demoGraphBounds).x

    expect(left).toBeGreaterThanOrEqual(16)
    expect(pin.x + 47 + 17 + 360).toBeLessThanOrEqual(1376 - 56)
  })
})
