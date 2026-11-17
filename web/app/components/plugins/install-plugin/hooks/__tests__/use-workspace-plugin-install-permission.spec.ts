import { describe, expect, it } from 'vite-plus/test'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { renderHook } from '@/test/console/render'
import useWorkspacePluginInstallPermission from '../use-workspace-plugin-install-permission'

describe('Workspace plugin capabilities', () => {
  it.each([
    {
      permission: 'plugin.install',
      install: true,
      update: true,
      remove: false,
      debug: false,
      preferences: false,
    },
    {
      permission: 'plugin.delete',
      install: false,
      update: false,
      remove: true,
      debug: false,
      preferences: false,
    },
    {
      permission: 'plugin.debug',
      install: false,
      update: false,
      remove: false,
      debug: true,
      preferences: false,
    },
    {
      permission: 'plugin.plugin_preferences',
      install: false,
      update: false,
      remove: false,
      debug: false,
      preferences: true,
    },
    {
      permission: '',
      install: false,
      update: false,
      remove: false,
      debug: false,
      preferences: false,
    },
  ])(
    'grants only the capabilities authorized by "$permission"',
    ({ permission, install, update, remove, debug, preferences }) => {
      const { wrapper } = createConsoleQueryWrapper({
        accountProfileMeta: { currentVersion: '1.0.0' },
        workspacePermissionKeys: permission ? [permission] : [],
      })
      const { result } = renderHook(() => useWorkspacePluginInstallPermission(), { wrapper })

      expect(result.current).toMatchObject({
        canInstallPlugin: install,
        canUpdatePlugin: update,
        canDeletePlugin: remove,
        canDebugPlugin: debug,
        canSetPluginPreferences: preferences,
      })
    },
  )
})
