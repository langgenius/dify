import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useGetIcon from '../use-get-icon'

vi.mock('@/config', () => ({
  API_PREFIX: 'https://api.example.com',
}))

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: { currentWorkspace: { id: string } }) => string | { id: string }) =>
    selector({ currentWorkspace: { id: 'workspace-123' } }),
}))

describe('useGetIcon', () => {
  it('builds icon url with current workspace id', () => {
    const { result } = renderHook(() => useGetIcon())

    expect(result.current.getIconUrl('plugin-icon.png')).toBe(
      'https://api.example.com/workspaces/current/plugin/icon?tenant_id=workspace-123&filename=plugin-icon.png',
    )
  })
})
