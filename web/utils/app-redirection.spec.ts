/**
 * Test suite for app redirection utility functions
 * Tests navigation path generation based on user permissions and app modes
 */
import { AppModeEnum } from '@/types/app'
import { AppACLPermission } from '@/utils/permission'
import { getRedirection, getRedirectionPath } from './app-redirection'

describe('app-redirection', () => {
  /**
   * Tests getRedirectionPath which determines the correct path based on:
   * - App ACL layout access permissions
   * - App ACL monitor and access config permissions
   * - App mode (workflow, advanced-chat, chat, completion, agent-chat)
   */
  describe('getRedirectionPath', () => {
    it('returns develop path when app ACL cannot access guarded pages', () => {
      const app = { id: 'app-123', mode: AppModeEnum.CHAT, permission_keys: [] }
      const result = getRedirectionPath(app)
      expect(result).toBe('/app/app-123/develop')
    })

    it('returns workflow path for workflow mode when app ACL can access layout', () => {
      const app = {
        id: 'app-123',
        mode: AppModeEnum.WORKFLOW,
        permission_keys: [AppACLPermission.ViewLayout],
      }
      const result = getRedirectionPath(app)
      expect(result).toBe('/app/app-123/workflow')
    })

    it('returns workflow path for advanced-chat mode when app ACL can access layout', () => {
      const app = {
        id: 'app-123',
        mode: AppModeEnum.ADVANCED_CHAT,
        permission_keys: [AppACLPermission.TestAndRun],
      }
      const result = getRedirectionPath(app)
      expect(result).toBe('/app/app-123/workflow')
    })

    it('returns configuration path for chat mode when app ACL can access layout', () => {
      const app = {
        id: 'app-123',
        mode: AppModeEnum.CHAT,
        permission_keys: [AppACLPermission.Edit],
      }
      const result = getRedirectionPath(app)
      expect(result).toBe('/app/app-123/configuration')
    })

    it('returns configuration path for completion mode when app ACL can access layout', () => {
      const app = {
        id: 'app-123',
        mode: AppModeEnum.COMPLETION,
        permission_keys: [AppACLPermission.ViewLayout],
      }
      const result = getRedirectionPath(app)
      expect(result).toBe('/app/app-123/configuration')
    })

    it('returns configuration path for agent-chat mode when app ACL can access layout', () => {
      const app = {
        id: 'app-456',
        mode: AppModeEnum.AGENT_CHAT,
        permission_keys: [AppACLPermission.ViewLayout],
      }
      const result = getRedirectionPath(app)
      expect(result).toBe('/app/app-456/configuration')
    })

    it('handles different app IDs', () => {
      const app1 = { id: 'abc-123', mode: AppModeEnum.CHAT, permission_keys: [] }
      const app2 = {
        id: 'xyz-789',
        mode: AppModeEnum.WORKFLOW,
        permission_keys: [AppACLPermission.ViewLayout],
      }

      expect(getRedirectionPath(app1)).toBe('/app/abc-123/develop')
      expect(getRedirectionPath(app2)).toBe('/app/xyz-789/workflow')
    })

    it('returns layout path when the app maintainer has app.create_and_management permission without app ACL keys', () => {
      const app = { id: 'app-123', mode: AppModeEnum.CHAT, permission_keys: [] }

      expect(
        getRedirectionPath(app, {
          currentUserId: 'user-1',
          resourceMaintainer: 'user-1',
          workspacePermissionKeys: ['app.create_and_management'],
        }),
      ).toBe('/app/app-123/configuration')
    })

    it('returns access config path when app ACL can only configure access', () => {
      const app = {
        id: 'app-123',
        mode: AppModeEnum.CHAT,
        permission_keys: [AppACLPermission.AccessConfig],
      }

      expect(getRedirectionPath(app, { isRbacEnabled: true })).toBe('/app/app-123/access-config')
    })

    it('returns develop path for access config only apps when RBAC is disabled', () => {
      const app = {
        id: 'app-123',
        mode: AppModeEnum.CHAT,
        permission_keys: [AppACLPermission.AccessConfig],
      }

      expect(getRedirectionPath(app, { isRbacEnabled: false })).toBe('/app/app-123/develop')
    })

    it('returns overview path when app ACL can only monitor the app', () => {
      const app = {
        id: 'app-123',
        mode: AppModeEnum.CHAT,
        permission_keys: [AppACLPermission.Monitor],
      }

      expect(getRedirectionPath(app)).toBe('/app/app-123/overview')
    })

    it('returns logs path when app ACL can only access logs and annotations', () => {
      const app = {
        id: 'app-123',
        mode: AppModeEnum.CHAT,
        permission_keys: [AppACLPermission.LogAndAnnotation],
      }

      expect(getRedirectionPath(app)).toBe('/app/app-123/logs')
    })
  })

  /**
   * Tests getRedirection which combines path generation with a redirect callback
   */
  describe('getRedirection', () => {
    /**
     * Tests that the redirection function is called with the correct path
     */
    it('calls redirection function with develop path when app ACL cannot access guarded pages', () => {
      const app = { id: 'app-123', mode: AppModeEnum.CHAT, permission_keys: [] }
      const mockRedirect = vi.fn()

      getRedirection(app, mockRedirect)

      expect(mockRedirect).toHaveBeenCalledWith('/app/app-123/develop')
      expect(mockRedirect).toHaveBeenCalledTimes(1)
    })

    it('calls redirection function with workflow path when app ACL can access layout', () => {
      const app = {
        id: 'app-123',
        mode: AppModeEnum.WORKFLOW,
        permission_keys: [AppACLPermission.ViewLayout],
      }
      const mockRedirect = vi.fn()

      getRedirection(app, mockRedirect)

      expect(mockRedirect).toHaveBeenCalledWith('/app/app-123/workflow')
      expect(mockRedirect).toHaveBeenCalledTimes(1)
    })

    it('calls redirection function with configuration path for chat mode with layout access', () => {
      const app = {
        id: 'app-123',
        mode: AppModeEnum.CHAT,
        permission_keys: [AppACLPermission.ViewLayout],
      }
      const mockRedirect = vi.fn()

      getRedirection(app, mockRedirect)

      expect(mockRedirect).toHaveBeenCalledWith('/app/app-123/configuration')
      expect(mockRedirect).toHaveBeenCalledTimes(1)
    })

    it('works with different redirection functions', () => {
      const app = {
        id: 'app-123',
        mode: AppModeEnum.WORKFLOW,
        permission_keys: [AppACLPermission.ViewLayout],
      }
      const paths: string[] = []
      const customRedirect = (path: string) => paths.push(path)

      getRedirection(app, customRedirect)

      expect(paths).toEqual(['/app/app-123/workflow'])
    })
  })
})
