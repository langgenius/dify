import type { SourceProviderOption } from '../provider-options'
import { sourceDraftForProviderOption, sourceProviderPresentation } from '../provider-options'

function providerOption({ key, label }: { key: string; label: string }) {
  return {
    datasource: {
      parameters: [
        {
          default: 'new-default',
          label: { en_US: 'Workspace' },
          name: 'workspace',
          type: 'string',
        },
      ],
    },
    key,
    label,
  } as SourceProviderOption
}

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

describe('sourceDraftForProviderOption', () => {
  it('resets provider-specific fields when a different provider has the same label', () => {
    const draft = {
      parameters: { oldWorkspace: 'stale-value' },
      provider: 'Docs',
      providerKey: 'onlineDocuments:old-provider',
      sourceName: 'Existing source',
      sourceType: 'onlineDocuments' as const,
      syncPolicy: 'daily' as const,
    }

    expect(
      sourceDraftForProviderOption(
        draft,
        providerOption({ key: 'onlineDocuments:new-provider', label: 'Docs' }),
      ),
    ).toEqual({
      parameters: { workspace: 'new-default' },
      provider: 'Docs',
      providerKey: 'onlineDocuments:new-provider',
      sourceName: '',
      sourceType: 'onlineDocuments',
      syncPolicy: 'daily',
    })
  })

  it('preserves provider fields when the stable provider key matches after a label change', () => {
    const draft = {
      parameters: { workspace: 'saved-workspace' },
      provider: 'Old Docs Name',
      providerKey: 'onlineDocuments:provider',
      sourceName: 'Existing source',
      sourceType: 'onlineDocuments' as const,
      syncPolicy: 'daily' as const,
    }

    expect(
      sourceDraftForProviderOption(
        draft,
        providerOption({ key: 'onlineDocuments:provider', label: 'New Docs Name' }),
      ),
    ).toEqual({
      ...draft,
      provider: 'New Docs Name',
    })
  })
})
