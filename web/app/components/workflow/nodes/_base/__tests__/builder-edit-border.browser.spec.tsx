import { cdp, page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { BuilderEditBorder } from '../builder-edit-border'

it('keeps the flowing dashes continuous at the closed seam when the node resizes', async () => {
  // Real SVG geometry and ResizeObserver prove the seam closes without stretching the dashes.
  await page.viewport(1000, 800)
  const session = cdp()
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  })
  const view = (width: number, height: number, zoom: number) => (
    <div
      role="group"
      aria-label="Highlighted node"
      style={{
        position: 'relative',
        width,
        height,
        margin: 24,
        border: '1px solid transparent',
        transform: `scale(${zoom})`,
      }}
    >
      <BuilderEditBorder />
    </div>
  )
  try {
    const screen = await render(view(242, 198, 1))
    const node = screen.getByRole('group', { name: 'Highlighted node' })
    await expect.element(node).toBeVisible()
    const metrics = () => {
      // The decorative SVG is intentionally hidden from the accessibility tree.
      const border = node.element().querySelector('rect')!
      const dashes = getComputedStyle(border)
        .strokeDasharray.split(/[,\s]+/)
        .map(Number.parseFloat)
      const period = dashes.reduce((sum, dash) => sum + dash, 0)
      const perimeter = border.getTotalLength()
      const calibratedLength = border.pathLength.baseVal || perimeter
      const cycles = calibratedLength / period
      return {
        seamError: Math.abs(cycles - Math.round(cycles)),
        dashLength: (dashes[0]! * perimeter) / calibratedLength,
        border,
        period,
      }
    }

    await expect.poll(() => metrics().seamError).toBeLessThan(0.00001)
    const initialDashLength = metrics().dashLength
    await screen.rerender(view(613, 347, 0.75))
    await expect.poll(() => Math.abs(metrics().dashLength - initialDashLength)).toBeLessThan(0.1)
    expect(metrics().seamError).toBeLessThan(0.00001)

    const { border, period } = metrics()
    const keyframes = (border.getAnimations()[0]!.effect as KeyframeEffect).getKeyframes()
    const start = Number.parseFloat(String(keyframes[0]!.strokeDashoffset))
    const end = Number.parseFloat(String(keyframes.at(-1)!.strokeDashoffset))
    const animatedCycles = (end - start) / period
    expect(Math.abs(animatedCycles - Math.round(animatedCycles))).toBeLessThan(0.00001)
  } finally {
    await session.send('Emulation.setEmulatedMedia', { features: [] })
  }
})
