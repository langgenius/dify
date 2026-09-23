import { describe, expect, it } from 'vite-plus/test'
import {
  buildTemplateDetailHref,
  buildTemplatesHref,
  parseTemplateDetailPath,
  parseTemplatesRoute,
} from '../template-links'

const id = 'c558a1fb-bb8c-4a5e-9404-d681c6659cf2'

describe('buildTemplatesHref', () => {
  it('appends selected languages as a comma-separated query value', () => {
    expect(buildTemplatesHref({ category: 'all', languages: ['en', 'ja'] })).toBe(
      '/templates?languages=en%2Cja',
    )
  })
})

describe('embedded template detail URLs', () => {
  it('builds /templates/{publisher}/{uuid} independently of the mutable title', () => {
    expect(
      buildTemplateDetailHref({
        id,
        publisher_unique_handle: 'acme labs',
      }),
    ).toBe(`/templates/acme%20labs/${id}`)
  })

  it('reads a template dialog path and ignores catalog or non-uuid segments', () => {
    expect(parseTemplateDetailPath(`/templates/acme%20labs/${id}`)).toEqual({
      publisher: 'acme labs',
      id,
    })
    expect(parseTemplateDetailPath('/templates')).toBeUndefined()
    expect(parseTemplateDetailPath('/templates/marketing')).toBeUndefined()
    expect(parseTemplateDetailPath('/templates/acme%20labs/Old%20title')).toBeUndefined()
  })

  it('keeps /templates/{publisher}/{uuid} on the all catalog with a selected template', () => {
    expect(parseTemplatesRoute(['acme labs', id])).toEqual({
      category: 'all',
      selection: { publisher: 'acme labs', id },
    })
    expect(parseTemplatesRoute(['marketing'])).toEqual({ category: 'marketing' })
    expect(parseTemplatesRoute(undefined)).toEqual({ category: 'all' })
  })
})
