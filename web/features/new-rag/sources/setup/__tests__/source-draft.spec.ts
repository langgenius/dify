import {
  createNewKnowledgeSourceDraft,
  normalizeWebsiteSourceUrl,
  parseNewKnowledgeSourceDraft,
} from '../source-draft'

describe('New knowledge source draft', () => {
  it('keeps a dynamically discovered provider supplied by the add-source entry point', () => {
    expect(createNewKnowledgeSourceDraft('onlineDrive', 'Acme Drive').provider).toBe('Acme Drive')
  })

  it('defaults every source type to a daily sync policy', () => {
    expect(createNewKnowledgeSourceDraft('onlineDocuments').syncPolicy).toBe('daily')
    expect(createNewKnowledgeSourceDraft('onlineDrive').syncPolicy).toBe('daily')
    expect(createNewKnowledgeSourceDraft('websiteCrawl').syncPolicy).toBe('daily')
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
          syncPolicy: 'daily',
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
      syncPolicy: 'daily',
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
