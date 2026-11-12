import type { consoleClient } from '@/service/console'
import { page } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { datasetsPage, members, setup, spacesPage } from './new-knowledge-list-test-env'

const api = vi.hoisted(() => ({
  spaces: vi.fn<typeof consoleClient.knowledgeFs.spaces.get>(),
  deleteSpace: vi.fn<typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.delete>(),
  members: vi.fn<typeof consoleClient.workspaces.current.members.get>(),
  upgradeJobs: vi.fn<typeof consoleClient.datasets.knowledgeFsUpgradeJobs.get>(),
  upgradeJob: vi.fn<typeof consoleClient.datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get>(),
  datasets: vi.fn<typeof consoleClient.datasets.get>(),
  push: vi.fn(),
}))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => ({ push: api.push }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.get': api.spaces,
      'knowledgeFs.spaces.byControlSpaceId.delete': api.deleteSpace,
      'workspaces.current.members.get': api.members,
      'datasets.knowledgeFsUpgradeJobs.get': api.upgradeJobs,
      'datasets.get': api.datasets,
      'datasets.byDatasetId.knowledgeFsUpgrades.byJobId.get': api.upgradeJob,
      'datasets.apiBaseInfo.get': async () => ({ api_base_url: 'https://api.example.com' }),
      'datasets.externalKnowledgeApi.get': async () => ({
        data: [],
        has_more: false,
        limit: 100,
        page: 1,
        total: 0,
      }),
      'tags.get': async () => [
        { binding_count: '1', id: 'tag-1', name: 'Customer support', type: 'knowledge' },
        { binding_count: '1', id: 'tag-2', name: 'Public docs', type: 'knowledge' },
      ],
    }),
  }
})

describe('NewKnowledgeList empty workspace', () => {
  beforeEach(async () => {
    await page.viewport(1000, 760)
    onTestFinished(guardUnexpectedFetch())
    api.spaces.mockResolvedValue(spacesPage())
    api.deleteSpace.mockResolvedValue({ result: 'success' })
    api.members.mockResolvedValue({ accounts: members })
    api.upgradeJobs.mockResolvedValue({ data: [] })
    api.upgradeJob.mockImplementation(() => new Promise(() => {}))
    api.datasets.mockResolvedValue(datasetsPage([]))
  })

  describe('empty workspace', () => {
    it('links available creation modes', async () => {
      await setup()

      const connectSource = page.getByRole('link', {
        name: 'knowledgeSpace.connectSource',
      })
      await expect
        .element(connectSource)
        .toHaveAttribute('href', '/datasets/new/create?start=source')
      await expect
        .element(connectSource)
        .toHaveAccessibleDescription(
          'knowledgeSpace.connectSourceDescription dataset.firstEmpty.recommended',
        )
      await expect
        .element(page.getByRole('link', { name: 'knowledgeSpace.uploadFiles' }))
        .toHaveAttribute('href', '/datasets/new/create?start=upload')
      await expect
        .element(page.getByRole('link', { name: 'knowledgeSpace.startEmpty' }))
        .toHaveAttribute('href', '/datasets/new/create?start=empty')
      await expect
        .element(page.getByRole('link', { name: 'common.operation.create' }))
        .toHaveAttribute('href', '/datasets/new/create')
    })

    it('keeps upload unavailable when KnowledgeFS upload is disabled', async () => {
      await setup({ knowledgeFsFeatures: { upload_enabled: false } })

      const uploadFiles = page.getByRole('button', { name: 'knowledgeSpace.uploadFiles' })
      await expect.element(uploadFiles).toBeDisabled()
      await expect
        .element(uploadFiles)
        .toHaveAccessibleDescription(
          'knowledgeSpace.uploadFilesDescription dataset.cornerLabel.unavailable',
        )
    })

    it.each([
      ['external-connect only', ['dataset.external.connect']],
      ['read-only', []],
    ])('hides creation entries from %s users', async (_, workspacePermissionKeys) => {
      await setup({ workspacePermissionKeys })

      await expect.element(page.getByText('knowledgeSpace.readOnlyEmpty')).toBeInTheDocument()
      await expect
        .element(page.getByRole('link', { name: 'common.operation.create' }))
        .not.toBeInTheDocument()
      await expect
        .element(page.getByRole('link', { name: 'knowledgeSpace.connectSource' }))
        .not.toBeInTheDocument()
    })
  })
})
