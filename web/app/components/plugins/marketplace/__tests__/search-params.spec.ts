import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCategoryParser,
  mockStringParser,
  mockArrayParser,
  mockParseAsStringEnum,
  mockParseAsArrayOf,
} = vi.hoisted(() => {
  const mockCategoryParser = {
    withDefault: vi.fn(() => ({
      withOptions: vi.fn(() => 'category-parser'),
    })),
  }
  const mockStringParser = {
    withDefault: vi.fn(() => ({
      withOptions: vi.fn(() => 'string-parser'),
    })),
  }
  const mockArrayParser = {
    withDefault: vi.fn(() => ({
      withOptions: vi.fn(() => 'array-parser'),
    })),
  }
  return {
    mockCategoryParser,
    mockStringParser,
    mockArrayParser,
    mockParseAsStringEnum: vi.fn(() => mockCategoryParser),
    mockParseAsArrayOf: vi.fn(() => mockArrayParser),
  }
})

vi.mock('nuqs/server', () => ({
  parseAsStringEnum: mockParseAsStringEnum,
  parseAsString: mockStringParser,
  parseAsArrayOf: mockParseAsArrayOf,
}))

describe('marketplace search params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('builds parser definitions with expected defaults and options', async () => {
    const { marketplaceSearchParamsParsers } = await import('../search-params')
    const { PLUGIN_TYPE_SEARCH_MAP } = await import('../constants')

    expect(mockParseAsStringEnum).toHaveBeenCalledWith(Object.values(PLUGIN_TYPE_SEARCH_MAP))
    expect(mockCategoryParser.withDefault).toHaveBeenCalledWith('all')
    expect(mockStringParser.withDefault).toHaveBeenCalledWith('')
    expect(mockParseAsArrayOf).toHaveBeenCalledWith(mockStringParser)
    expect(mockArrayParser.withDefault).toHaveBeenCalledWith([])
    expect(marketplaceSearchParamsParsers).toEqual({
      category: 'category-parser',
      q: 'string-parser',
      tags: 'array-parser',
    })
  })
})
