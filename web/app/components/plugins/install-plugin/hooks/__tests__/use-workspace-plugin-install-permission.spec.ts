import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useWorkspacePluginInstallPermission from '../use-workspace-plugin-install-permission'

let mockWorkspacePermissionKeys: string[] = []

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    langGeniusVersionInfo: {
      current_env: '',
      current_version: '1.0.0',
      latest_version: '',
      release_date: '',
      release_notes: '',
      version: '',
      can_auto_update: false,
    },
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    langGeniusVersionInfo: {
      current_env: '',
      current_version: '1.0.0',
      latest_version: '',
      release_date: '',
      release_notes: '',
      version: '',
      can_auto_update: false,
    },
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    langGeniusVersionInfo: {
      current_env: '',
      current_version: '1.0.0',
      latest_version: '',
      release_date: '',
      release_notes: '',
      version: '',
      can_auto_update: false,
    },
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    langGeniusVersionInfo: {
      current_env: '',
      current_version: '1.0.0',
      latest_version: '',
      release_date: '',
      release_notes: '',
      version: '',
      can_auto_update: false,
    },
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    langGeniusVersionInfo: {
      current_env: '',
      current_version: '1.0.0',
      latest_version: '',
      release_date: '',
      release_notes: '',
      version: '',
      can_auto_update: false,
    },
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

describe('useWorkspacePluginInstallPermission', () => {
  beforeEach(() => {
    mockWorkspacePermissionKeys = []
  })

  it('should grant install and update capabilities with plugin.install', () => {
    mockWorkspacePermissionKeys = ['plugin.install']

    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(true)
    expect(result.current.canUpdatePlugin).toBe(true)
    expect(result.current.canDeletePlugin).toBe(false)
    expect(result.current.canDebugPlugin).toBe(false)
    expect(result.current.canSetPluginPreferences).toBe(false)
  })

  it('should not expose installed plugin list viewing as a permission capability', () => {
    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect('canViewInstalledPlugins' in result.current).toBe(false)
  })

  it('should grant delete capability but not install or update with plugin.delete', () => {
    mockWorkspacePermissionKeys = ['plugin.delete']

    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(false)
    expect(result.current.canUpdatePlugin).toBe(false)
    expect(result.current.canDeletePlugin).toBe(true)
    expect(result.current.canDebugPlugin).toBe(false)
    expect(result.current.canSetPluginPreferences).toBe(false)
  })

  it('should grant plugin debug capability with plugin.debug', () => {
    mockWorkspacePermissionKeys = ['plugin.debug']

    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(false)
    expect(result.current.canUpdatePlugin).toBe(false)
    expect(result.current.canDeletePlugin).toBe(false)
    expect(result.current.canDebugPlugin).toBe(true)
    expect(result.current.canSetPluginPreferences).toBe(false)
  })

  it('should grant plugin preference setting capability with plugin.plugin_preferences', () => {
    mockWorkspacePermissionKeys = ['plugin.plugin_preferences']

    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(false)
    expect(result.current.canUpdatePlugin).toBe(false)
    expect(result.current.canDeletePlugin).toBe(false)
    expect(result.current.canDebugPlugin).toBe(false)
    expect(result.current.canSetPluginPreferences).toBe(true)
  })

  it('should deny plugin capabilities without plugin install or manage permissions', () => {
    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(false)
    expect(result.current.canUpdatePlugin).toBe(false)
    expect(result.current.canDeletePlugin).toBe(false)
    expect(result.current.canDebugPlugin).toBe(false)
    expect(result.current.canSetPluginPreferences).toBe(false)
  })
})
