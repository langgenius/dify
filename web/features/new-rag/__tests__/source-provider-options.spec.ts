import { sourceProviderPresentation } from '../source-provider-options'

describe('sourceProviderPresentation', () => {
  it.each([
    ['Firecrawl', 'websiteCrawl', 'Firecrawl', 'i-custom-public-common-firecrawl'],
    ['Jina Reader', 'websiteCrawl', 'Jina Reader', 'i-custom-public-llm-jina'],
    ['WaterCrawl', 'websiteCrawl', 'WaterCrawl', 'i-custom-public-knowledge-watercrawl'],
    ['OneDrive', 'onlineDrive', 'OneDrive', 'i-logos-microsoft-onedrive'],
    ['aws_s3', 'onlineDrive', 'Amazon S3', 'i-logos-aws-s3'],
    ['notion_datasource', 'onlineDocuments', 'Notion', 'i-custom-public-common-notion'],
  ] as const)(
    'returns the canonical presentation for %s',
    (provider, sourceType, label, fallbackIcon) => {
      expect(sourceProviderPresentation(provider, sourceType)).toEqual({ fallbackIcon, label })
    },
  )

  it('does not collapse a custom provider name that merely contains a built-in brand', () => {
    expect(sourceProviderPresentation('Notion Backup', 'onlineDocuments')).toBeUndefined()
  })
})
