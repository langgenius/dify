import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useWorkspacePluginInstallPermission from '../use-workspace-plugin-install-permission'

let mockWorkspacePermissionKeys: string[] = []

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    langGeniusVersionInfo: { current_version: '1.0.0' },
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }),
}))

describe('useWorkspacePluginInstallPermission', () => {
  beforeEach(() => {
    mockWorkspacePermissionKeys = []
  })

  it('should grant install and update capabilities with plugin.install', () => {
    mockWorkspacePermissionKeys = ['plugin.install']

    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(true)
    expect(result.current.canUpdatePlugin).toBe(true)
    expect(result.current.canViewInstalledPlugins).toBe(true)
    expect(result.current.canManagePlugin).toBe(false)
  })

  it('should grant update, view, and manage capabilities but not install with plugin.manage', () => {
    mockWorkspacePermissionKeys = ['plugin.manage']

    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(false)
    expect(result.current.canUpdatePlugin).toBe(true)
    expect(result.current.canViewInstalledPlugins).toBe(true)
    expect(result.current.canManagePlugin).toBe(true)
  })

  it('should deny plugin capabilities without plugin install or manage permissions', () => {
    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(false)
    expect(result.current.canUpdatePlugin).toBe(false)
    expect(result.current.canViewInstalledPlugins).toBe(false)
    expect(result.current.canManagePlugin).toBe(false)
  })
})
