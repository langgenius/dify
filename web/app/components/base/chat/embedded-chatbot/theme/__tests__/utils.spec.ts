import { CssTransform, hexToRGBA } from '../utils'

describe('theme value conversions', () => {
  it.each([
    ['#000000', 0, 'rgba(0,0,0,0)'],
    ['FFFFFF', 0.5, 'rgba(255,255,255,0.5)'],
    ['#12AB34', 1, 'rgba(18,171,52,1)'],
  ])('converts %s with opacity %s', (hex, opacity, expected) => {
    expect(hexToRGBA(hex, opacity)).toBe(expected)
  })

  it('parses style declarations while trimming whitespace and skipping empty pairs', () => {
    expect(CssTransform('  color : red ;; margin: 10px; ')).toEqual({
      color: 'red',
      margin: '10px',
    })
  })

  it('has no declarations for an empty style', () => {
    expect(CssTransform('')).toEqual({})
  })
})
