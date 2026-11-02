import type { DatasourceProviderAuthResponse } from '@dify/contracts/api/console/auth/types.gen'
import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { CrawlOptions } from '@/models/datasets'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import Website from '../index'

let mockEnableJinaReader = true
let mockEnableFirecrawl = true
let mockEnableWatercrawl = true

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get ENABLE_WEBSITE_JINAREADER() {
    return mockEnableJinaReader
  },
  get ENABLE_WEBSITE_FIRECRAWL() {
    return mockEnableFirecrawl
  },
  get ENABLE_WEBSITE_WATERCRAWL() {
    return mockEnableWatercrawl
  },
}))

const createMockCrawlOptions = (overrides: Partial<CrawlOptions> = {}): CrawlOptions => ({
  crawl_sub_pages: true,
  limit: 10,
  max_depth: 2,
  excludes: '',
  includes: '',
  only_main_content: false,
  use_sitemap: false,
  ...overrides,
})

const createMockDataSourceAuth = (
  provider: string,
  credentialsCount = 1,
): DatasourceProviderAuthResponse => ({
  author: 'test',
  provider,
  plugin_id: `${provider}-plugin`,
  plugin_unique_identifier: `${provider}-unique`,
  icon: 'icon.png',
  name: provider,
  label: { en_US: provider, zh_Hans: provider },
  description: { en_US: `${provider} description`, zh_Hans: `${provider} description` },
  credential_schema: [],
  oauth_schema: null,
  credentials_list: Array.from({ length: credentialsCount }, (_, i) => ({
    credential: {},
    type: CredentialTypeEnum.API_KEY,
    name: `cred-${i}`,
    id: `cred-${i}`,
    is_default: i === 0,
    avatar_url: '',
  })),
})

function setup(authedDataSourceList: DatasourceProviderAuthResponse[] = []) {
  const onCrawlProviderChange = vi.fn()
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  const renderWithNuqs = createNuqsTestRenderer(renderWithConsoleQuery, () => ({ onUrlUpdate }))
  return {
    ...renderWithNuqs(
      <Website
        onPreview={vi.fn()}
        checkedCrawlResult={[]}
        onCheckedCrawlResultChange={vi.fn()}
        onCrawlProviderChange={onCrawlProviderChange}
        onJobIdChange={vi.fn()}
        crawlOptions={createMockCrawlOptions()}
        onCrawlOptionsChange={vi.fn()}
        authedDataSourceList={authedDataSourceList}
      />,
    ),
    onCrawlProviderChange,
    onUrlUpdate,
  }
}

beforeEach(() => {
  mockEnableJinaReader = true
  mockEnableFirecrawl = true
  mockEnableWatercrawl = true
})

it.each([
  ['firecrawl', /Firecrawl/, 'firecrawlTitle'],
  ['watercrawl', /WaterCrawl/, 'watercrawlTitle'],
] as const)('switches to the authenticated %s crawl form', async (provider, label, title) => {
  const user = userEvent.setup()
  const { onCrawlProviderChange } = setup([
    createMockDataSourceAuth('jinareader'),
    createMockDataSourceAuth(provider),
  ])
  expect(screen.getByRole('radio', { name: 'Jina Reader' })).toBeChecked()
  await user.click(screen.getByRole('radio', { name: label }))
  expect(screen.getByRole('radio', { name: label })).toBeChecked()
  expect(screen.getByText(`datasetCreation.stepOne.website.${title}`)).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'datasetCreation.stepOne.website.run' }),
  ).toBeInTheDocument()
  expect(onCrawlProviderChange).toHaveBeenCalledWith(provider)
})

it.each([{ providers: [] }, { providers: [createMockDataSourceAuth('jinareader', 0)] }])(
  'routes unconfigured providers to data source settings',
  async ({ providers }) => {
    const user = userEvent.setup()
    const { onUrlUpdate } = setup(providers)
    expect(
      screen.getByText('datasetCreation.stepOne.website.jinaReaderNotConfigured'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'datasetCreation.stepOne.website.run' }),
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'datasetCreation.stepOne.website.configure' }),
    )
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('data-source'),
    )
  },
)

it('offers only providers enabled in deployment configuration', () => {
  mockEnableFirecrawl = false
  mockEnableWatercrawl = false
  setup()
  expect(screen.getByRole('radio', { name: 'Jina Reader' })).toBeInTheDocument()
  expect(screen.queryByRole('radio', { name: /Firecrawl/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('radio', { name: 'WaterCrawl' })).not.toBeInTheDocument()
})

it('omits provider selection and setup when all website integrations are disabled', () => {
  mockEnableJinaReader = false
  mockEnableFirecrawl = false
  mockEnableWatercrawl = false
  setup()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'datasetCreation.stepOne.website.configure' }),
  ).not.toBeInTheDocument()
})
