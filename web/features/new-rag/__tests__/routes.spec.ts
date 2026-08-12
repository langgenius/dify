import {
  createNewKnowledgeSourceDraft,
  newKnowledgeAddSourcePath,
  newKnowledgeDocumentDetailPath,
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

  it('builds a document chunk deep link with its revision', () => {
    expect(
      newKnowledgeDocumentDetailPath('space-1', 'document-1', {
        chunkId: 'chunk/with spaces',
        revision: 3,
      }),
    ).toBe('/datasets/new/space-1/documents/document-1?revision=3&chunk=chunk%2Fwith+spaces')
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

  it('keeps a dynamically discovered provider supplied by the add-source entry point', () => {
    expect(createNewKnowledgeSourceDraft('onlineDrive', 'Acme Drive').provider).toBe('Acme Drive')
  })

  it('defaults website crawls to a daily sync policy', () => {
    expect(createNewKnowledgeSourceDraft('websiteCrawl').syncPolicy).toBe('daily')
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
      parameters: {},
      provider: 'Firecrawl',
      rootUrl: 'https://docs.dify.ai',
      sourceName: 'Dify docs',
      sourceType: 'websiteCrawl',
      syncPolicy: 'provider',
    })
  })

  it('restores a valid custom sync interval and rejects incomplete custom policies', () => {
    const customDraft = {
      includeSubpages: true,
      maxPages: 100,
      provider: 'Firecrawl',
      rootUrl: 'https://docs.dify.ai',
      sourceName: 'Dify docs',
      sourceType: 'websiteCrawl',
      syncPolicy: 'custom',
    }

    expect(
      parseNewKnowledgeSourceDraft(
        JSON.stringify({ ...customDraft, customIntervalSeconds: 129_600 }),
      ),
    ).toEqual(expect.objectContaining({ customIntervalSeconds: 129_600, syncPolicy: 'custom' }))
    expect(parseNewKnowledgeSourceDraft(JSON.stringify(customDraft))).toBeUndefined()
  })
})
