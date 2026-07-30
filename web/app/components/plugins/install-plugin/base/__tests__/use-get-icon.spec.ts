import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@/test/console/render'
import useGetIcon from '../use-get-icon'

vi.mock('@/config', () => ({
  API_PREFIX: 'https://api.example.com',
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')

  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-123' },
  }))
})

describe('useGetIcon', () => {
  it('builds icon url with current workspace id', () => {
    const { result } = renderHook(() => useGetIcon())

    expect(result.current.getIconUrl('plugin-icon.png')).toBe(
      'https://api.example.com/workspaces/current/plugin/icon?tenant_id=workspace-123&filename=plugin-icon.png',
    )
  })
})
