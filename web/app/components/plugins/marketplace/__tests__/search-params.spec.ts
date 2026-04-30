import { describe, expect, it } from 'vitest'
import { PLUGIN_TYPE_SEARCH_MAP } from '../constants'
import { marketplaceSearchParamsParsers } from '../search-params'

describe('marketplace search params', () => {
  it('applies the expected default values', () => {
    expect(marketplaceSearchParamsParsers.category.parseServerSide(undefined)).toBe(PLUGIN_TYPE_SEARCH_MAP.all)
    expect(marketplaceSearchParamsParsers.q.parseServerSide(undefined)).toBe('')
    expect(marketplaceSearchParamsParsers.tags.parseServerSide(undefined)).toEqual([])
  })

  it('parses supported query values with the configured parsers', () => {
    expect(marketplaceSearchParamsParsers.category.parseServerSide(PLUGIN_TYPE_SEARCH_MAP.tool)).toBe(PLUGIN_TYPE_SEARCH_MAP.tool)
    expect(marketplaceSearchParamsParsers.category.parseServerSide('unsupported')).toBe(PLUGIN_TYPE_SEARCH_MAP.all)
    expect(marketplaceSearchParamsParsers.q.parseServerSide('keyword')).toBe('keyword')
    expect(marketplaceSearchParamsParsers.tags.parseServerSide('rag,search')).toEqual(['rag', 'search'])
  })
})
