import {
  createNewKnowledgeSourceDraft,
  newKnowledgeAddSourcePath,
  newKnowledgeRetrievalTestPath,
  newKnowledgeSettingsPath,
  normalizeWebsiteSourceUrl,
  parseNewKnowledgeSourceDraft,
  singleSearchParam,
} from '../routes'

describe('New RAG routes', () => {
  it('builds the settings path from the knowledge space id', () => {
    expect(newKnowledgeSettingsPath('space-1')).toBe('/datasets/new/space-1/settings')
  })

  it('builds the retrieval test path from the knowledge space id', () => {
    expect(newKnowledgeRetrievalTestPath('space-1')).toBe('/datasets/new/space-1/retrieval')
  })

  it('keeps source details out of the add-source URL', () => {
    expect(
      newKnowledgeAddSourcePath('space-1', {
        draftKey: 'opaque-draft-key',
        sourceType: 'websiteCrawl',
      }),
    ).toBe('/datasets/new/space-1/sources/new?type=websiteCrawl&draft=opaque-draft-key')
  })

  it('builds a provider-specific add-source URL', () => {
    expect(
      newKnowledgeAddSourcePath('space-1', {
        provider: 'Jina Reader',
        sourceType: 'websiteCrawl',
      }),
    ).toBe('/datasets/new/space-1/sources/new?type=websiteCrawl&provider=Jina+Reader')
  })

  it('falls back when a provider does not belong to the selected source type', () => {
    expect(createNewKnowledgeSourceDraft('onlineDrive', 'Confluence').provider).toBe('Google Drive')
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
          sourceType: 'websiteCrawl',
          syncPolicy: 'provider',
        }),
      ),
    ).toBeUndefined()
  })

  it('migrates a valid website draft saved before source discriminators were added', () => {
    expect(
      parseNewKnowledgeSourceDraft(
        JSON.stringify({
          includeSubpages: false,
          maxPages: 25,
          provider: 'Firecrawl',
          rootUrl: 'https://docs.dify.ai',
          sourceName: 'Dify docs',
        }),
      ),
    ).toEqual({
      includeSubpages: false,
      maxPages: 25,
      provider: 'Firecrawl',
      rootUrl: 'https://docs.dify.ai',
      sourceName: 'Dify docs',
      sourceType: 'websiteCrawl',
      syncPolicy: 'provider',
    })
  })
})
