import { createLoader } from 'nuqs/server'
import { describe, expect, it } from 'vite-plus/test'
import { PLUGIN_TYPE_SEARCH_MAP } from '../constants'
import { marketplaceSearchParamsParsers } from '../search-params'

const loadSearchParams = createLoader(marketplaceSearchParamsParsers)

describe('marketplace search params', () => {
  it('applies the expected default values', () => {
    expect(loadSearchParams({})).toEqual({
      category: PLUGIN_TYPE_SEARCH_MAP.all,
      q: '',
      tags: [],
      languages: [],
    })
  })

  it('parses supported query values with the configured parsers', () => {
    expect(
      loadSearchParams({
        category: PLUGIN_TYPE_SEARCH_MAP.tool,
        q: 'keyword',
        tags: 'rag,search',
        languages: 'en,zh-Hans',
      }),
    ).toEqual({
      category: PLUGIN_TYPE_SEARCH_MAP.tool,
      q: 'keyword',
      tags: ['rag', 'search'],
      languages: ['en', 'zh-Hans'],
    })
    expect(loadSearchParams({ category: 'unsupported' }).category).toBe(PLUGIN_TYPE_SEARCH_MAP.all)
  })
})
