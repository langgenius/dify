import type { Category, Tag } from '../constant'
import { describe, expect, it } from 'vitest'

describe('filter-management constant types', () => {
  it('accepts tag objects with binding counts', () => {
    const tag: Tag = {
      id: 'tag-1',
      name: 'search',
      type: 'plugin',
      binding_count: 3,
    }

    expect(tag).toEqual({
      id: 'tag-1',
      name: 'search',
      type: 'plugin',
      binding_count: 3,
    })
  })

  it('accepts supported category names', () => {
    const category: Category = {
      name: 'tool',
      binding_count: 8,
    }

    expect(category).toEqual({
      name: 'tool',
      binding_count: 8,
    })
  })
})
