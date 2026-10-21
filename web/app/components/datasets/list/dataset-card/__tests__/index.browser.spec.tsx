import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { consoleQueryKey } from '@/test/console/operation-hooks'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { DatasetACLPermission } from '@/utils/permission'
import DatasetCard from '../index'

vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

vi.mock('@/context/permission-state', async () => {
  const { atom } = await import('jotai')
  return { workspacePermissionKeysAtom: atom([]) }
})

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({
    queryKey: consoleQueryKey('account.profile.get'),
    queryFn: async () => ({ profile: { id: 'user-1' } }),
  }),
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: consoleQueryKey('systemFeatures.get'),
    queryFn: async () => ({ rbac_enabled: true }),
  }),
}))

const centerOf = (element: Element) => {
  const rect = element.getBoundingClientRect()
  return [rect.left + rect.width / 2, rect.top + rect.height / 2] as const
}

it('makes the whole card the entry while footer details and tags stay separate controls', async () => {
  // Real layout proves the stretched entry, the unclipped card focus, and the pointer targets of
  // controls positioned above it.
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
  queryClient.setQueryData(
    consoleQuery.tags.get.queryOptions({ input: { query: { type: 'knowledge' } } }).queryKey,
    [],
  )
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <button type="button">Before dataset</button>
      <ul className="mt-4 grid w-80 p-4">
        <DatasetCard
          dataset={createDatasetFixture({
            permission_keys: [DatasetACLPermission.Edit],
            document_count: 3,
          })}
        />
      </ul>
    </QueryClientProvider>,
  )

  const link = screen.getByRole('link', { name: 'Test Dataset' })
  const card = link.element().closest('li')!
  screen.getByRole('button', { name: 'Before dataset' }).element().focus()
  await userEvent.keyboard('{Tab}')
  await expect.element(link).toHaveFocus()
  await expect.poll(() => getComputedStyle(card, '::after').boxShadow).toContain('inset')

  await userEvent.keyboard('{Tab}')
  const tags = screen.getByRole('combobox', { name: /^common.tag/ })
  await expect.element(tags).toHaveFocus()
  expect(getComputedStyle(card, '::after').boxShadow).toBe('none')

  const documents = screen.getByRole('button', { name: /common.datasetMenus.documents$/ })
  for (const control of [tags.element(), documents.element()]) {
    const target = document.elementFromPoint(...centerOf(control))
    expect(control.contains(target)).toBe(true)
    expect(target?.closest('a')).toBeNull()
  }
  const updated = screen.getByText(/^dataset.updated /).element()
  expect(document.elementFromPoint(...centerOf(updated))?.closest('a')).toBe(link.element())

  await userEvent.click(documents)
  await expect
    .element(screen.getByRole('dialog', { name: 'common.datasetMenus.documents' }))
    .toBeVisible()
})
