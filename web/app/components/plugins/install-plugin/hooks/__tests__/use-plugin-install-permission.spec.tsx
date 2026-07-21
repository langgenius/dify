import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import usePluginInstallPermission, {
  createPluginInstallPermissionStore,
  PluginInstallPermissionContext,
  usePluginInstallPermissionStore,
} from '../use-plugin-install-permission'

describe('usePluginInstallPermission', () => {
  // Store creation defaults update permission to install permission when not provided.
  describe('Store Defaults', () => {
    it('should default update permission from install permission', () => {
      const store = createPluginInstallPermissionStore({
        canInstallPlugin: false,
      })

      expect(store.getState().canInstallPlugin).toBe(false)
      expect(store.getState().canUpdatePlugin).toBe(false)
    })
  })

  // Hook consumers read values from the plugin install permission context.
  describe('Context', () => {
    it('should expose plugin install permissions from context store', () => {
      const store = createPluginInstallPermissionStore({
        canInstallPlugin: true,
        canUpdatePlugin: false,
        currentDifyVersion: '1.2.3',
      })
      const wrapper = ({ children }: { children: ReactNode }) => (
        <PluginInstallPermissionContext value={store}>{children}</PluginInstallPermissionContext>
      )

      const { result } = renderHook(() => usePluginInstallPermission(), { wrapper })

      expect(result.current).toEqual({
        canInstallPlugin: true,
        canUpdatePlugin: false,
        currentDifyVersion: '1.2.3',
      })
    })

    it('should throw when provider is missing', () => {
      expect(() => {
        renderHook(() => usePluginInstallPermissionStore((state) => state.canInstallPlugin))
      }).toThrow('Missing PluginInstallPermissionProvider in the tree')
    })
  })
})
