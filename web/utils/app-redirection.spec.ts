/**
 * Test suite for app redirection utility functions
 * Tests navigation path generation based on user permissions and app modes
 */
import { getRedirection, getRedirectionPath } from './app-redirection'

describe('app-redirection', () => {
  /**
   * Tests getRedirectionPath which determines the correct path based on:
   * - User's editor permissions
   * - App mode (workflow, advanced-chat, chat, completion, agent-chat)
   */
  describe('getRedirectionPath', () => {
    test('returns overview path when user is not editor', () => {
      const app = { id: 'app-123', mode: 'chat' as const }
      const result = getRedirectionPath(false, app)
      expect(result).toBe('/app/app-123/overview')
    })

    test('returns workflow path for workflow mode when user is editor', () => {
      const app = { id: 'app-123', mode: 'workflow' as const }
      const result = getRedirectionPath(true, app)
      expect(result).toBe('/app/app-123/workflow')
    })

    test('returns workflow path for advanced-chat mode when user is editor', () => {
      const app = { id: 'app-123', mode: 'advanced-chat' as const }
      const result = getRedirectionPath(true, app)
      expect(result).toBe('/app/app-123/workflow')
    })

    test('returns configuration path for chat mode when user is editor', () => {
      const app = { id: 'app-123', mode: 'chat' as const }
      const result = getRedirectionPath(true, app)
      expect(result).toBe('/app/app-123/configuration')
    })

    test('returns configuration path for completion mode when user is editor', () => {
      const app = { id: 'app-123', mode: 'completion' as const }
      const result = getRedirectionPath(true, app)
      expect(result).toBe('/app/app-123/configuration')
    })

    test('returns configuration path for agent-chat mode when user is editor', () => {
      const app = { id: 'app-456', mode: 'agent-chat' as const }
      const result = getRedirectionPath(true, app)
      expect(result).toBe('/app/app-456/configuration')
    })

    test('handles different app IDs', () => {
      const app1 = { id: 'abc-123', mode: 'chat' as const }
      const app2 = { id: 'xyz-789', mode: 'workflow' as const }

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
    test('calls redirection function with correct path for non-editor', () => {
      const app = { id: 'app-123', mode: 'chat' as const }
      const mockRedirect = jest.fn()

      getRedirection(false, app, mockRedirect)

      expect(mockRedirect).toHaveBeenCalledWith('/app/app-123/overview')
      expect(mockRedirect).toHaveBeenCalledTimes(1)
    })

    test('calls redirection function with workflow path for editor', () => {
      const app = { id: 'app-123', mode: 'workflow' as const }
      const mockRedirect = jest.fn()

      getRedirection(true, app, mockRedirect)

      expect(mockRedirect).toHaveBeenCalledWith('/app/app-123/workflow')
      expect(mockRedirect).toHaveBeenCalledTimes(1)
    })

    test('calls redirection function with configuration path for chat mode editor', () => {
      const app = { id: 'app-123', mode: 'chat' as const }
      const mockRedirect = jest.fn()

      getRedirection(true, app, mockRedirect)

      expect(mockRedirect).toHaveBeenCalledWith('/app/app-123/configuration')
      expect(mockRedirect).toHaveBeenCalledTimes(1)
    })

    test('works with different redirection functions', () => {
      const app = { id: 'app-123', mode: 'workflow' as const }
      const paths: string[] = []
      const customRedirect = (path: string) => paths.push(path)

      getRedirection(true, app, customRedirect)

      expect(paths).toEqual(['/app/app-123/workflow'])
    })
  })
})
