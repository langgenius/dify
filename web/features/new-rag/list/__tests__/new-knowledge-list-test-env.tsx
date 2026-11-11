import type { KnowledgeFsUpgradeJobResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { consoleClient } from '@/service/console'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { KnowledgeUpgradeProvider } from '../../upgrade/knowledge-upgrade-context'
import { NewKnowledgeList } from '../new-knowledge-list'

type KnowledgeFsSpaceListResponse = Awaited<ReturnType<typeof consoleClient.knowledgeFs.spaces.get>>
type KnowledgeFsSpaceListItemResponse = KnowledgeFsSpaceListResponse['data'][number]
export type DatasetListResponse = Awaited<ReturnType<typeof consoleClient.datasets.get>>

export const space = (
  id: string,
  name: string,
  overrides: Partial<KnowledgeFsSpaceListItemResponse> = {},
): KnowledgeFsSpaceListItemResponse => ({
  control_space_id: id,
  created_at: '2026-07-15T00:00:00Z',
  knowledge_space_id: id,
  linked_apps: 0,
  owner_account_id: 'account-1',
  permission_keys: ['knowledge_space_read'],
  resource_version: 1,
  state: 'active',
  technical_status: 'available',
  technical_summary: {
    description: null,
    document_count: 0,
    icon: null,
    knowledge_space_id: id,
    name,
    revision: 1,
    slug: id,
  },
  updated_at: '2026-07-18T00:00:00Z',
  visibility: 'only_me',
  ...overrides,
})

export const spacesPage = (
  data: KnowledgeFsSpaceListItemResponse[] = [],
  { page = 1, hasMore = false } = {},
): KnowledgeFsSpaceListResponse => ({ data, has_more: hasMore, limit: 30, page })

export const job = (
  overrides: Partial<KnowledgeFsUpgradeJobResponse> = {},
): KnowledgeFsUpgradeJobResponse => ({
  completed_documents: 4,
  completed_sources: 1,
  id: 'upgrade-1',
  old_dataset_id: 'dataset-1',
  snapshot_at: '2026-08-18T00:00:00Z',
  stage: 'submitting_documents',
  status: 'running',
  total_documents: 10,
  total_sources: 1,
  ...overrides,
})

export const legacyDataset = (
  latestJob: KnowledgeFsUpgradeJobResponse,
  discovery: { can_retry?: boolean; can_upgrade?: boolean } = {},
) => ({
  ...createDatasetFixture({ id: latestJob.old_dataset_id, name: 'Support knowledge' }),
  knowledge_fs_upgrade: {
    can_retry: false,
    can_upgrade: false,
    ...discovery,
    job: latestJob,
  },
})

export const datasetsPage = (data: DatasetListResponse['data']): DatasetListResponse => ({
  data,
  has_more: false,
  limit: 50,
  page: 1,
  total: data.length,
})

export const members = [
  { id: 'account-1', name: 'Alice', status: 'active' },
  { id: 'account-2', name: 'Bob', status: 'active' },
  { id: 'account-pending', name: 'Pending member', status: 'pending' },
].map((member) => ({
  ...member,
  avatar_url: null,
  email: `${member.id}@example.test`,
  role: 'normal' as const,
}))

export const knowledgeList = () => page.getByRole('list', { name: 'dataset.knowledge' })
export const upgradeCards = (name: string) =>
  knowledgeList().getByRole('listitem').filter({ hasText: name })
export const search = () => page.getByRole('searchbox', { name: 'common.operation.search' })
export const recoveryKeys = () => [
  consoleQuery.knowledgeFs.spaces.get.key(),
  consoleQuery.datasets.knowledgeFsUpgradeJobs.get.key(),
  consoleQuery.datasets.get.key(),
]

export async function setup({
  searchParams = '',
  ...options
}: ConsoleQueryTestOptions & { searchParams?: string } = {}) {
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({
    searchParams,
    hasMemory: true,
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    accountProfile: { id: 'account-1' },
    features: { enable_knowledge_fs: true },
    knowledgeFsFeatures: { upload_enabled: true },
    workspacePermissionKeys: ['dataset.create_and_management', 'dataset.external.connect'],
    ...options,
  })
  const rendered = await render(
    <QueryProvider>
      <UrlState>
        <KnowledgeUpgradeProvider onUpgradeStarted={() => {}}>
          <NewKnowledgeList />
        </KnowledgeUpgradeProvider>
      </UrlState>
    </QueryProvider>,
  )
  const refresh = (...queryKeys: readonly unknown[][]) =>
    Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
  return { ...rendered, queryClient, onUrlUpdate, refresh }
}

export const lastSearchParams = (onUrlUpdate: Awaited<ReturnType<typeof setup>>['onUrlUpdate']) =>
  onUrlUpdate.mock.calls.at(-1)?.[0].searchParams
