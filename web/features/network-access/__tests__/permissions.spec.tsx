import { act, waitFor } from '@testing-library/react'
import { useAtomValue } from 'jotai'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import {
  canManageNetworkAccessPoliciesAtom,
  canReadNetworkAccessAtom,
  canViewNetworkAccessStatusAtom,
} from '../permissions'

function useNetworkAccessPermissions() {
  return {
    canRead: useAtomValue(canReadNetworkAccessAtom),
    canManage: useAtomValue(canManageNetworkAccessPoliciesAtom),
    canViewStatus: useAtomValue(canViewNetworkAccessStatusAtom),
  }
}

describe('network access permissions', () => {
  it.each([
    { role: 'owner', canRead: true, canManage: true, canViewStatus: true },
    { role: 'admin', canRead: true, canManage: true, canViewStatus: true },
    { role: 'editor', canRead: true, canManage: false, canViewStatus: true },
    { role: 'normal', canRead: false, canManage: false, canViewStatus: true },
    { role: 'dataset_operator', canRead: false, canManage: false, canViewStatus: false },
  ] as const)(
    'allows the supported operations for $role',
    ({ role, canRead, canManage, canViewStatus }) => {
      const { result } = renderHookWithConsoleQuery(useNetworkAccessPermissions, {
        currentWorkspace: { role },
        systemFeatures: { deployment_edition: 'CLOUD' },
      })
      expect(result.current).toEqual({ canRead, canManage, canViewStatus })
    },
  )

  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'does not grant access in %s',
    (deployment_edition) => {
      const { result } = renderHookWithConsoleQuery(useNetworkAccessPermissions, {
        currentWorkspace: { role: 'owner' },
        systemFeatures: { deployment_edition },
      })
      expect(result.current).toEqual({ canRead: false, canManage: false, canViewStatus: false })
    },
  )

  it('waits for the authoritative workspace and responds to role changes', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => new Promise(() => {}))
    const { result, queryClient } = renderHookWithConsoleQuery(useNetworkAccessPermissions, {
      currentWorkspace: null,
      systemFeatures: { deployment_edition: 'CLOUD' },
    })
    expect(result.current).toEqual({ canRead: false, canManage: false, canViewStatus: false })

    await act(async () => {
      seedCurrentWorkspaceQuery(queryClient, { role: 'admin' })
    })
    await waitFor(() =>
      expect(result.current).toEqual({ canRead: true, canManage: true, canViewStatus: true }),
    )

    await act(async () => {
      seedCurrentWorkspaceQuery(queryClient, { role: 'editor' })
    })
    await waitFor(() =>
      expect(result.current).toEqual({ canRead: true, canManage: false, canViewStatus: true }),
    )
  })
})
