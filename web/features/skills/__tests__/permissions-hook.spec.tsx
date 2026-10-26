import type { QueryKey } from '@tanstack/react-query'
import type { PermissionKey } from '@/models/access-control'
import { QueryClient, QueryClientProvider, queryOptions, useQuery } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { atom, createStore, Provider } from 'jotai'
import { describe, expect, it, vi } from 'vite-plus/test'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { setSkillDetailCache } from '../detail/shared'
import { useSkillPermissions } from '../permissions'

vi.mock('@/context/permission-state', () => ({
  workspacePermissionKeysAtom: atom<PermissionKey[]>([]),
}))
vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({
    queryKey: ['test-profile'],
    queryFn: vi.fn(),
    staleTime: Infinity,
  }),
}))
vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['test-system'],
    queryFn: vi.fn(),
    staleTime: Infinity,
  }),
}))

const profileKey: QueryKey = userProfileQueryOptions().queryKey
const systemKey: QueryKey = systemFeaturesQueryOptions().queryKey

function DeleteAction() {
  const permissions = useSkillPermissions()
  const { data } = useQuery(
    queryOptions<{ data: { maintainer?: string | null }[] }>({
      queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
      queryFn: vi.fn(),
      staleTime: Infinity,
    }),
  )
  return permissions.canDeleteSkill(data?.data[0]?.maintainer) ? (
    <button>Delete Skill</button>
  ) : null
}

describe('Skill delete capability updates', () => {
  it('recomputes the action after profile, permission, RBAC and maintainer cache updates', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const store = createStore()
    const permissionAtom = workspacePermissionKeysAtom as ReturnType<typeof atom<PermissionKey[]>>
    store.set(permissionAtom, ['skill.edit'])
    const detail: Parameters<typeof setSkillDetailCache>[2] = {
      id: 'skill',
      name: 'skill',
      display_name: 'Skill',
      description: '',
      icon: '📄',
      visibility: 'workspace',
      maintainer: 'alice',
      created_at: 1,
      updated_at: 1,
      files: [],
    }
    queryClient.setQueryData(profileKey, { profile: { id: 'alice' } })
    queryClient.setQueryData(systemKey, { rbac_enabled: true })
    queryClient.setQueryData(consoleQuery.workspaces.current.skills.get.key({ type: 'query' }), {
      data: [detail],
    })
    render(
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <DeleteAction />
        </QueryClientProvider>
      </Provider>,
    )
    expect(await screen.findByRole('button', { name: 'Delete Skill' })).toBeVisible()
    await act(async () => {
      setSkillDetailCache(queryClient, detail.id, { ...detail, maintainer: null })
    })
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument())
    await act(async () => {
      setSkillDetailCache(queryClient, detail.id, detail)
    })
    expect(await screen.findByRole('button')).toBeVisible()
    await act(async () => {
      queryClient.setQueryData(profileKey, { profile: { id: 'bob' } })
    })
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument())
    await act(async () => {
      store.set(permissionAtom, ['skill.delete'])
    })
    expect(await screen.findByRole('button')).toBeVisible()
    await act(async () => {
      queryClient.setQueryData(profileKey, { profile: { id: 'alice' } })
      store.set(permissionAtom, ['skill.edit'])
      queryClient.setQueryData(systemKey, { rbac_enabled: false })
    })
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument())
    queryClient.clear()
  })
})
