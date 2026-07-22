import {
  newKnowledgeAddSourcePath,
  normalizeWebsiteSourceUrl,
  parseNewKnowledgeSourceDraft,
  singleSearchParam,
} from '../routes'

describe('New RAG routes', () => {
  it('keeps source details out of the add-source URL', () => {
    expect(newKnowledgeAddSourcePath('space-1', 'websiteCrawl', 'opaque-draft-key')).toBe(
      '/datasets/new/space-1/sources/new?type=websiteCrawl&draft=opaque-draft-key',
    )
  })

  it('rejects repeated search parameters instead of selecting an ambiguous value', () => {
    expect(singleSearchParam(['websiteCrawl', 'onlineDrive'])).toBeUndefined()
    expect(singleSearchParam('websiteCrawl')).toBe('websiteCrawl')
  })

  it('rejects credentials embedded in website URLs', () => {
    expect(normalizeWebsiteSourceUrl('https://user:secret@docs.dify.ai')).toBeUndefined()
    expect(normalizeWebsiteSourceUrl('https://docs.dify.ai/docs#intro')?.toString()).toBe(
      'https://docs.dify.ai/docs',
    )
  })

  it('rejects malformed session drafts', () => {
    expect(parseNewKnowledgeSourceDraft('{')).toBeUndefined()
    expect(
      parseNewKnowledgeSourceDraft(
        JSON.stringify({
          includeSubpages: true,
          maxPages: 201,
          provider: 'Firecrawl',
          rootUrl: 'https://docs.dify.ai',
          sourceName: 'Dify docs',
        }),
      ),
    ).toBeUndefined()
  })
})
