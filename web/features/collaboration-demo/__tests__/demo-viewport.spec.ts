import { demoGraphBounds } from '../demo-graph'
import { getDemoViewport, getThreadPlacement } from '../demo-viewport'
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
  ])('keeps the comment thread beside the flow on a %ix%i canvas', (width, height) => {
    const viewport = getDemoViewport(width, height)
    const graphRight = toScreen(viewport, {
      x: demoGraphBounds.x + demoGraphBounds.width,
      y: demoGraphBounds.y,
    }).x
    const thread = getThreadPlacement(toScreen(viewport, demoCommentPosition), { width, height })

    expect(thread.left).toBeGreaterThan(graphRight)
    expect(thread.left + 360).toBeLessThanOrEqual(width)
    expect(thread.top + 360).toBeLessThanOrEqual(height)
  })

  it('keeps the thread inside a narrow canvas', () => {
    const viewport = getDemoViewport(704, 900)
    const thread = getThreadPlacement(toScreen(viewport, demoCommentPosition), {
      width: 704,
      height: 900,
    })

    expect(thread.left).toBeGreaterThanOrEqual(8)
    expect(thread.left + 360).toBeLessThanOrEqual(704)
  })
})
