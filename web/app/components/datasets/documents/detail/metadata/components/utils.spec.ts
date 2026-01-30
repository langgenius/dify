import { describe, expect, it } from 'vitest'
import { map2Options } from './utils'

describe('map2Options', () => {
  it('should convert a map to array of options', () => {
    const map = {
      en: 'English',
      zh: 'Chinese',
    }

    const result = map2Options(map)

    expect(result).toEqual([
      { value: 'en', name: 'English' },
      { value: 'zh', name: 'Chinese' },
    ])
  })

  it('should return empty array for empty map', () => {
    const map = {}

    const result = map2Options(map)

    expect(result).toEqual([])
  })

  it('should handle single entry map', () => {
    const map = { key: 'value' }

    const result = map2Options(map)

    expect(result).toEqual([{ value: 'key', name: 'value' }])
  })

  it('should handle map with special characters in keys', () => {
    const map = {
      'key-with-dash': 'Value 1',
      'key_with_underscore': 'Value 2',
    }

    const result = map2Options(map)

    expect(result).toContainEqual({ value: 'key-with-dash', name: 'Value 1' })
    expect(result).toContainEqual({ value: 'key_with_underscore', name: 'Value 2' })
  })

  it('should preserve order of keys', () => {
    const map = {
      a: 'Alpha',
      b: 'Beta',
      c: 'Gamma',
    }

    const result = map2Options(map)
    const values = result.map(opt => opt.value)

    expect(values).toEqual(['a', 'b', 'c'])
  })
})
