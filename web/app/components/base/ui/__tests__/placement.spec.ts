import { describe, expect, it } from 'vitest'
import { parsePlacement } from '../placement'

describe('parsePlacement', () => {
  it('should parse placement without explicit alignment as center', () => {
    expect(parsePlacement('top')).toEqual({
      side: 'top',
      align: 'center',
    })
  })

  it('should parse start aligned placement', () => {
    expect(parsePlacement('bottom-start')).toEqual({
      side: 'bottom',
      align: 'start',
    })
  })

  it('should parse end aligned placement', () => {
    expect(parsePlacement('left-end')).toEqual({
      side: 'left',
      align: 'end',
    })
  })
})
