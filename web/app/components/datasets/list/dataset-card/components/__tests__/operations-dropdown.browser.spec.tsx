import type { DataSet } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { DatasetACLPermission } from '@/utils/permission'
import CornerLabels from '../corner-labels'
import OperationsDropdown from '../operations-dropdown'

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

it.each([true, false])(
  'keeps operations visible and keyboard accessible with embedding available: %s',
  async (embeddingAvailable) => {
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
    const openRenameModal = vi.fn()
    const dataset = {
      id: 'dataset-1',
      name: 'Test Dataset',
      runtime_mode: 'general',
      embedding_available: embeddingAvailable,
      permission_keys: [DatasetACLPermission.Edit],
    } as DataSet
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <button type="button">Before dataset</button>
        <div className="group relative mt-10 h-40 w-80">
          <CornerLabels dataset={dataset} />
          <OperationsDropdown
            dataset={dataset}
            openRenameModal={openRenameModal}
            handleExportPipeline={vi.fn()}
            detectIsUsedByApp={vi.fn()}
            openAccessConfig={vi.fn()}
          />
        </div>
        <button type="button">After dataset</button>
      </QueryClientProvider>,
    )

    screen.getByRole('button', { name: 'Before dataset' }).element().focus()
    await userEvent.keyboard('{Tab}')
    const trigger = screen.getByRole('button', { name: 'Dataset operations' })
    await expect.element(trigger).toHaveFocus()
    await expect.element(trigger).toBeVisible()
    if (!embeddingAvailable) {
      const unavailableLabel = screen.getByText('dataset.cornerLabel.unavailable')
      await expect.element(unavailableLabel).toBeVisible()
      expect(unavailableLabel.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
        trigger.element().getBoundingClientRect().top,
      )
    }
    await userEvent.keyboard('{Enter}')
    const edit = screen.getByRole('menuitem', { name: 'common.operation.edit' })
    await expect.element(edit).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(openRenameModal).toHaveBeenCalledTimes(1)
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  },
)
