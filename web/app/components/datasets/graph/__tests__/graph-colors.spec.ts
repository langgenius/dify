import { Theme } from '@/types/app'
import { getGraphChartColors, getNodeSize, MAX_NODE_SIZE, MIN_NODE_SIZE } from '../graph-colors'

describe('getGraphChartColors', () => {
  it('returns distinct light and dark palettes', () => {
    const light = getGraphChartColors(Theme.light)
    const dark = getGraphChartColors(Theme.dark)

    // The dark steps are selected for the dark surface, not an automatic flip.
    expect(light.node).not.toBe(dark.node)
    expect(light.surface).not.toBe(dark.surface)
  })

  it('falls back to the light palette when the theme is unresolved', () => {
    expect(getGraphChartColors(undefined)).toEqual(getGraphChartColors(Theme.light))
  })

  it('keeps the focused node distinguishable from ordinary nodes', () => {
    for (const theme of [Theme.light, Theme.dark]) {
      const colors = getGraphChartColors(theme)
      expect(colors.focusedNode).not.toBe(colors.node)
    }
  })

  it('returns a stable object reference so chart options are not rebuilt each render', () => {
    expect(getGraphChartColors(Theme.light)).toBe(getGraphChartColors(Theme.light))
  })
})

describe('getNodeSize', () => {
  it('gives the smallest node the minimum size', () => {
    expect(getNodeSize(1, 100)).toBeGreaterThanOrEqual(MIN_NODE_SIZE)
  })

  it('gives the most frequent entity the maximum size', () => {
    expect(getNodeSize(100, 100)).toBeCloseTo(MAX_NODE_SIZE)
  })

  it('scales area rather than radius with frequency', () => {
    // A quarter of the max frequency should sit at half the size range.
    const size = getNodeSize(25, 100)
    expect(size).toBeCloseTo(MIN_NODE_SIZE + 0.5 * (MAX_NODE_SIZE - MIN_NODE_SIZE))
  })

  it('uses the minimum size when every entity is mentioned once', () => {
    expect(getNodeSize(1, 1)).toBe(MIN_NODE_SIZE)
  })

  it('never drops below the minimum for a zero frequency', () => {
    expect(getNodeSize(0, 50)).toBeGreaterThanOrEqual(MIN_NODE_SIZE)
  })

  it('is monotonic in frequency', () => {
    const sizes = [1, 10, 40, 80, 100].map((frequency) => getNodeSize(frequency, 100))
    const sorted = [...sizes].sort((a, b) => a - b)
    expect(sizes).toEqual(sorted)
  })
})
