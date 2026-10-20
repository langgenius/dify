import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetCard from '../../index'

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
// Tag editing is independently tested and does not own operation visibility.
vi.mock('@/features/tag-management/components/dataset-card-tags', () => ({
  DatasetCardTags: () => null,
}))

vi.mock('@/context/permission-state', async () => {
  const { atom } = await import('jotai')
  return { workspacePermissionKeysAtom: atom([]) }
})

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({
    queryKey: ['account-profile'],
    queryFn: async () => ({ profile: { id: 'user-1' } }),
  }),
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['system-features'],
    queryFn: async () => ({ rbac_enabled: true }),
  }),
}))

it('keeps operations visible on keyboard focus without covering the unavailable label', async () => {
  // Real CSS and native Tab navigation catch visibility-hidden triggers that happy-dom misses.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(userProfileQueryOptions().queryKey, {
    profile: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@dify.ai',
      avatar: '',
      avatar_url: null,
      is_password_set: false,
      timezone: 'Asia/Shanghai',
    },
    meta: { currentVersion: null, currentEnv: null },
  })
  queryClient.setQueryData(
    systemFeaturesQueryOptions().queryKey,
    createSystemFeaturesFixture({ rbac_enabled: true }),
  )
  const dataset = createDatasetFixture({
    id: 'dataset-1',
    name: 'Test Dataset',
    runtime_mode: 'general',
    embedding_available: false,
    permission_keys: [DatasetACLPermission.Edit],
  })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <button type="button">Before dataset</button>
      <div className="mt-10 w-80">
        <DatasetCard dataset={dataset} />
      </div>
      <button type="button">After dataset</button>
    </QueryClientProvider>,
  )

  screen.getByRole('button', { name: 'Before dataset' }).element().focus()
  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('link', { name: 'Test Dataset' })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect
    .element(screen.getByRole('button', { name: '0 common.datasetMenus.documents' }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('button', { name: '0 dataset.appCount' })).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  const trigger = screen.getByRole('button', { name: 'Dataset operations' })
  await expect.element(trigger).toHaveFocus()
  await expect.element(trigger).toBeVisible()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'common.operation.edit' }))
    .toBeVisible()
  const unavailableLabel = screen.getByText('dataset.cornerLabel.unavailable')
  await expect.element(unavailableLabel).toBeVisible()
  expect(unavailableLabel.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
    trigger.element().getBoundingClientRect().top,
  )
})
