import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useGetIcon from '../use-get-icon'

const mockCurrentWorkspaceIdAtom = vi.hoisted(() => Symbol('currentWorkspaceIdAtom'))

vi.mock('@/config', () => ({
  API_PREFIX: 'https://api.example.com',
}))

vi.mock('@/context/account-state', () => ({
  currentWorkspaceIdAtom: mockCurrentWorkspaceIdAtom,
}))
vi.mock('@/context/workspace-state', () => ({
  currentWorkspaceIdAtom: mockCurrentWorkspaceIdAtom,
}))
vi.mock('@/context/permission-state', () => ({
  currentWorkspaceIdAtom: mockCurrentWorkspaceIdAtom,
}))
vi.mock('@/context/version-state', () => ({
  currentWorkspaceIdAtom: mockCurrentWorkspaceIdAtom,
}))
vi.mock('@/context/system-features-state', () => ({
  currentWorkspaceIdAtom: mockCurrentWorkspaceIdAtom,
}))

vi.mock('jotai', () => {
  return {
    useAtomValue: (atom: unknown) => {
      if (atom === mockCurrentWorkspaceIdAtom) return 'workspace-123'

      throw new Error('Unexpected atom')
    },
  }
})

describe('useGetIcon', () => {
  it('builds icon url with current workspace id', () => {
    const { result } = renderHook(() => useGetIcon())

    expect(result.current.getIconUrl('plugin-icon.png')).toBe(
      'https://api.example.com/workspaces/current/plugin/icon?tenant_id=workspace-123&filename=plugin-icon.png',
    )
  })
})
