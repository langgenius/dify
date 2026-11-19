import { describe, expect, it } from 'vitest'
import { applyResetOnChange } from '../reset-on-change'

type Schema = {
  variable: string
  default?: unknown
  reset_on_change?: string[]
}

const resetValue = (schema: Schema) => schema.default ?? null

describe('applyResetOnChange', () => {
  it('should reset watched dependents in the same value update', () => {
    const nextValue = applyResetOnChange({
      schemas: [
        { variable: 'source' },
        { variable: 'dependent', default: 'default', reset_on_change: ['source'] },
      ],
      previousValue: { source: 'first', dependent: 'selected' },
      nextValue: { source: 'second', dependent: 'selected' },
      getResetValue: resetValue,
    })

    expect(nextValue).toEqual({ source: 'second', dependent: 'default' })
  })

  it('should preserve a dependent explicitly changed in the same update', () => {
    const nextValue = applyResetOnChange({
      schemas: [
        { variable: 'source' },
        { variable: 'dependent', default: 'default', reset_on_change: ['source'] },
      ],
      previousValue: { source: 'first', dependent: 'selected' },
      nextValue: { source: 'second', dependent: 'manual' },
      getResetValue: resetValue,
    })

    expect(nextValue).toEqual({ source: 'second', dependent: 'manual' })
  })

  it('should compare object values independent of property insertion order', () => {
    const nextValue = { source: { nested: 1, label: 'same' }, dependent: 'selected' }
    const result = applyResetOnChange({
      schemas: [
        { variable: 'source' },
        { variable: 'dependent', default: 'default', reset_on_change: ['source'] },
      ],
      previousValue: { source: { label: 'same', nested: 1 }, dependent: 'selected' },
      nextValue,
      getResetValue: resetValue,
    })

    expect(result).toBe(nextValue)
  })

  it('should reset transitive dependents once without looping through cycles', () => {
    const nextValue = applyResetOnChange({
      schemas: [
        { variable: 'source', default: 'source-default', reset_on_change: ['leaf'] },
        { variable: 'middle', default: 'middle-default', reset_on_change: ['source'] },
        { variable: 'leaf', default: 'leaf-default', reset_on_change: ['middle'] },
      ],
      previousValue: { source: 'first', middle: 'middle', leaf: 'leaf' },
      nextValue: { source: 'second', middle: 'middle', leaf: 'leaf' },
      getResetValue: resetValue,
    })

    expect(nextValue).toEqual({
      source: 'second',
      middle: 'middle-default',
      leaf: 'leaf-default',
    })
  })
})
