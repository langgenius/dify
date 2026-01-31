/**
 * Test suite for app redirection utility functions
 * Tests navigation path generation based on user permissions and app modes
 */
import { AppModeEnum } from '@/types/app'
import { getRedirection, getRedirectionPath } from './app-redirection'

describe('app-redirection', () => {
  /**
   * Tests getRedirectionPath which determines the correct path based on:
   * - User's editor permissions
   * - App mode (workflow, advanced-chat, chat, completion, agent-chat)
   */
  describe('getRedirectionPath', () => {
    it('returns overview path when user is not editor', () => {
      const app = { id: 'app-123', mode: AppModeEnum.CHAT }
      const result = getRedirectionPath(false, app)
      expect(result).toBe('/app/app-123/overview')
    })

    it('returns workflow path for workflow mode when user is editor', () => {
      const app = { id: 'app-123', mode: AppModeEnum.WORKFLOW }
      const result = getRedirectionPath(true, app)
      expect(result).toBe('/app/app-123/workflow')
    })

    it('returns workflow path for advanced-chat mode when user is editor', () => {
      const app = { id: 'app-123', mode: AppModeEnum.ADVANCED_CHAT }
      const result = getRedirectionPath(true, app)
      expect(result).toBe('/app/app-123/workflow')
    })

    it('returns configuration path for chat mode when user is editor', () => {
      const app = { id: 'app-123', mode: AppModeEnum.CHAT }
      const result = getRedirectionPath(true, app)
      expect(result).toBe('/app/app-123/configuration')
    })

    it('returns configuration path for completion mode when user is editor', () => {
      const app = { id: 'app-123', mode: AppModeEnum.COMPLETION }
      const result = getRedirectionPath(true, app)
      expect(result).toBe('/app/app-123/configuration')
    })

    it('returns configuration path for agent-chat mode when user is editor', () => {
      const app = { id: 'app-456', mode: AppModeEnum.AGENT_CHAT }
      const result = getRedirectionPath(true, app)
      expect(result).toBe('/app/app-456/configuration')
    })

    it('handles different app IDs', () => {
      const app1 = { id: 'abc-123', mode: AppModeEnum.CHAT }
      const app2 = { id: 'xyz-789', mode: AppModeEnum.WORKFLOW }

      expect(getRedirectionPath(false, app1)).toBe('/app/abc-123/overview')
      expect(getRedirectionPath(true, app2)).toBe('/app/xyz-789/workflow')
    })
  })

  /**
   * Tests getRedirection which combines path generation with a redirect callback
   */
  describe('getRedirection', () => {
    /**
     * Tests that the redirection function is called with the correct path
     */
    it('calls redirection function with correct path for non-editor', () => {
      const app = { id: 'app-123', mode: AppModeEnum.CHAT }
      const mockRedirect = vi.fn()

      getRedirection(false, app, mockRedirect)

      expect(mockRedirect).toHaveBeenCalledWith('/app/app-123/overview')
      expect(mockRedirect).toHaveBeenCalledTimes(1)
    })

    it('calls redirection function with workflow path for editor', () => {
      const app = { id: 'app-123', mode: AppModeEnum.WORKFLOW }
      const mockRedirect = vi.fn()

      getRedirection(true, app, mockRedirect)

      expect(mockRedirect).toHaveBeenCalledWith('/app/app-123/workflow')
      expect(mockRedirect).toHaveBeenCalledTimes(1)
    })

    it('calls redirection function with configuration path for chat mode editor', () => {
      const app = { id: 'app-123', mode: AppModeEnum.CHAT }
      const mockRedirect = vi.fn()

      getRedirection(true, app, mockRedirect)

      expect(mockRedirect).toHaveBeenCalledWith('/app/app-123/configuration')
      expect(mockRedirect).toHaveBeenCalledTimes(1)
    })

    it('works with different redirection functions', () => {
      const app = { id: 'app-123', mode: AppModeEnum.WORKFLOW }
      const paths: string[] = []
      const customRedirect = (path: string) => paths.push(path)

      getRedirection(true, app, customRedirect)

      expect(paths).toEqual(['/app/app-123/workflow'])
    })
  })
})
