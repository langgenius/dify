import { describe, expect, it } from 'vitest'
import { buildMarketplaceHref, buildSearchParamsString } from './utils'

describe('buildSearchParamsString', () => {
  it('filters undefined and null values', () => {
    const query = buildSearchParamsString({
      theme: undefined,
      language: 'en-US',
      templateId: 'tpl-1',
      empty: null as unknown as string,
    })
    expect(query).toBe('language=en-US&templateId=tpl-1')
    expect(query).not.toContain('theme=undefined')
    expect(query).not.toContain('empty=')
  })
})

describe('buildMarketplaceHref', () => {
  it('returns relative path with filtered query when includeSource is false', () => {
    const href = buildMarketplaceHref('/template/foo/bar', {
      theme: undefined,
      language: 'en-US',
      templateId: 'tpl-1',
    }, false)

    expect(href).toBe('/template/foo/bar?language=en-US&templateId=tpl-1')
    expect(href).not.toContain('theme=undefined')
  })

  it('delegates to marketplace source URL when includeSource is true', () => {
    const href = buildMarketplaceHref('/template/foo/bar', {
      language: 'en-US',
      templateId: 'tpl-1',
    }, true)

    expect(href).toContain('/template/foo/bar?')
    expect(href).toContain('source=')
    expect(href).toContain('language=en-US')
    expect(href).toContain('templateId=tpl-1')
  })
})
