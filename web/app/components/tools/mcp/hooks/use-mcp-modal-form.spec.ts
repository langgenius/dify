import type { AppIconEmojiSelection, AppIconImageSelection } from '@/app/components/base/app-icon-picker'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MCPAuthMethod } from '@/app/components/tools/types'
import { isValidServerID, isValidUrl, useMCPModalForm } from './use-mcp-modal-form'

// Mock the API service
vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: vi.fn(),
}))

describe('useMCPModalForm', () => {
  describe('Utility Functions', () => {
    describe('isValidUrl', () => {
      it('should return true for valid http URL', () => {
        expect(isValidUrl('http://example.com')).toBe(true)
      })

      it('should return true for valid https URL', () => {
        expect(isValidUrl('https://example.com')).toBe(true)
      })

      it('should return true for URL with path', () => {
        expect(isValidUrl('https://example.com/path/to/resource')).toBe(true)
      })

      it('should return true for URL with query params', () => {
        expect(isValidUrl('https://example.com?foo=bar')).toBe(true)
      })

      it('should return false for invalid URL', () => {
        expect(isValidUrl('not-a-url')).toBe(false)
      })

      it('should return false for ftp URL', () => {
        expect(isValidUrl('ftp://example.com')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isValidUrl('')).toBe(false)
      })

      it('should return false for file URL', () => {
        expect(isValidUrl('file:///path/to/file')).toBe(false)
      })
    })

    describe('isValidServerID', () => {
      it('should return true for lowercase letters', () => {
        expect(isValidServerID('myserver')).toBe(true)
      })

      it('should return true for numbers', () => {
        expect(isValidServerID('123')).toBe(true)
      })

      it('should return true for alphanumeric with hyphens', () => {
        expect(isValidServerID('my-server-123')).toBe(true)
      })

      it('should return true for alphanumeric with underscores', () => {
        expect(isValidServerID('my_server_123')).toBe(true)
      })

      it('should return true for max length (24 chars)', () => {
        expect(isValidServerID('abcdefghijklmnopqrstuvwx')).toBe(true)
      })

      it('should return false for uppercase letters', () => {
        expect(isValidServerID('MyServer')).toBe(false)
      })

      it('should return false for spaces', () => {
        expect(isValidServerID('my server')).toBe(false)
      })

      it('should return false for special characters', () => {
        expect(isValidServerID('my@server')).toBe(false)
      })

      it('should return false for empty string', () => {
        expect(isValidServerID('')).toBe(false)
      })

      it('should return false for string longer than 24 chars', () => {
        expect(isValidServerID('abcdefghijklmnopqrstuvwxy')).toBe(false)
      })
    })
  })

  describe('Hook Initialization', () => {
    describe('Create Mode (no data)', () => {
      it('should initialize with default values', () => {
        const { result } = renderHook(() => useMCPModalForm())

        expect(result.current.isCreate).toBe(true)
        expect(result.current.formKey).toBe('create')
        expect(result.current.state.url).toBe('')
        expect(result.current.state.name).toBe('')
        expect(result.current.state.serverIdentifier).toBe('')
        expect(result.current.state.timeout).toBe(30)
        expect(result.current.state.sseReadTimeout).toBe(300)
        expect(result.current.state.headers).toEqual([])
        expect(result.current.state.authMethod).toBe(MCPAuthMethod.authentication)
        expect(result.current.state.isDynamicRegistration).toBe(true)
        expect(result.current.state.clientID).toBe('')
        expect(result.current.state.credentials).toBe('')
      })

      it('should initialize with default emoji icon', () => {
        const { result } = renderHook(() => useMCPModalForm())

        expect(result.current.state.appIcon).toEqual({
          type: 'emoji',
          icon: '🔗',
          background: '#6366F1',
        })
      })
    })

    describe('Edit Mode (with data)', () => {
      const mockData: ToolWithProvider = {
        id: 'test-id-123',
        name: 'Test MCP Server',
        server_url: 'https://example.com/mcp',
        server_identifier: 'test-server',
        icon: { content: '🚀', background: '#FF0000' },
        configuration: {
          timeout: 60,
          sse_read_timeout: 600,
        },
        masked_headers: {
          'Authorization': '***',
          'X-Custom': 'value',
        },
        is_dynamic_registration: false,
        authentication: {
          client_id: 'client-123',
          client_secret: 'secret-456',
        },
      } as unknown as ToolWithProvider

      it('should initialize with data values', () => {
        const { result } = renderHook(() => useMCPModalForm(mockData))

        expect(result.current.isCreate).toBe(false)
        expect(result.current.formKey).toBe('test-id-123')
        expect(result.current.state.url).toBe('https://example.com/mcp')
        expect(result.current.state.name).toBe('Test MCP Server')
        expect(result.current.state.serverIdentifier).toBe('test-server')
        expect(result.current.state.timeout).toBe(60)
        expect(result.current.state.sseReadTimeout).toBe(600)
        expect(result.current.state.isDynamicRegistration).toBe(false)
        expect(result.current.state.clientID).toBe('client-123')
        expect(result.current.state.credentials).toBe('secret-456')
      })

      it('should initialize headers from masked_headers', () => {
        const { result } = renderHook(() => useMCPModalForm(mockData))

        expect(result.current.state.headers).toHaveLength(2)
        expect(result.current.state.headers[0].key).toBe('Authorization')
        expect(result.current.state.headers[0].value).toBe('***')
        expect(result.current.state.headers[1].key).toBe('X-Custom')
        expect(result.current.state.headers[1].value).toBe('value')
      })

      it('should initialize emoji icon from data', () => {
        const { result } = renderHook(() => useMCPModalForm(mockData))

        expect(result.current.state.appIcon.type).toBe('emoji')
        expect(((result.current.state.appIcon) as AppIconEmojiSelection).icon).toBe('🚀')
        expect(((result.current.state.appIcon) as AppIconEmojiSelection).background).toBe('#FF0000')
      })

      it('should store original server URL and ID', () => {
        const { result } = renderHook(() => useMCPModalForm(mockData))

        expect(result.current.originalServerUrl).toBe('https://example.com/mcp')
        expect(result.current.originalServerID).toBe('test-server')
      })
    })

    describe('Edit Mode with string icon', () => {
      const mockDataWithImageIcon: ToolWithProvider = {
        id: 'test-id',
        name: 'Test',
        icon: 'https://example.com/files/abc123/file-preview/icon.png',
      } as unknown as ToolWithProvider

      it('should initialize image icon from string URL', () => {
        const { result } = renderHook(() => useMCPModalForm(mockDataWithImageIcon))

        expect(result.current.state.appIcon.type).toBe('image')
        expect(((result.current.state.appIcon) as AppIconImageSelection).url).toBe('https://example.com/files/abc123/file-preview/icon.png')
        expect(((result.current.state.appIcon) as AppIconImageSelection).fileId).toBe('abc123')
      })
    })
  })

  describe('Actions', () => {
    it('should update url', () => {
      const { result } = renderHook(() => useMCPModalForm())

      act(() => {
        result.current.actions.setUrl('https://new-url.com')
      })

      expect(result.current.state.url).toBe('https://new-url.com')
    })

    it('should update name', () => {
      const { result } = renderHook(() => useMCPModalForm())

      act(() => {
        result.current.actions.setName('New Server Name')
      })

      expect(result.current.state.name).toBe('New Server Name')
    })

    it('should update serverIdentifier', () => {
      const { result } = renderHook(() => useMCPModalForm())

      act(() => {
        result.current.actions.setServerIdentifier('new-server-id')
      })

      expect(result.current.state.serverIdentifier).toBe('new-server-id')
    })

    it('should update timeout', () => {
      const { result } = renderHook(() => useMCPModalForm())

      act(() => {
        result.current.actions.setTimeout(120)
      })

      expect(result.current.state.timeout).toBe(120)
    })

    it('should update sseReadTimeout', () => {
      const { result } = renderHook(() => useMCPModalForm())

      act(() => {
        result.current.actions.setSseReadTimeout(900)
      })

      expect(result.current.state.sseReadTimeout).toBe(900)
    })

    it('should update headers', () => {
      const { result } = renderHook(() => useMCPModalForm())
      const newHeaders = [{ id: '1', key: 'X-New', value: 'new-value' }]

      act(() => {
        result.current.actions.setHeaders(newHeaders)
      })

      expect(result.current.state.headers).toEqual(newHeaders)
    })

    it('should update authMethod', () => {
      const { result } = renderHook(() => useMCPModalForm())

      act(() => {
        result.current.actions.setAuthMethod(MCPAuthMethod.headers)
      })

      expect(result.current.state.authMethod).toBe(MCPAuthMethod.headers)
    })

    it('should update isDynamicRegistration', () => {
      const { result } = renderHook(() => useMCPModalForm())

      act(() => {
        result.current.actions.setIsDynamicRegistration(false)
      })

      expect(result.current.state.isDynamicRegistration).toBe(false)
    })

    it('should update clientID', () => {
      const { result } = renderHook(() => useMCPModalForm())

      act(() => {
        result.current.actions.setClientID('new-client-id')
      })

      expect(result.current.state.clientID).toBe('new-client-id')
    })

    it('should update credentials', () => {
      const { result } = renderHook(() => useMCPModalForm())

      act(() => {
        result.current.actions.setCredentials('new-secret')
      })

      expect(result.current.state.credentials).toBe('new-secret')
    })

    it('should update appIcon', () => {
      const { result } = renderHook(() => useMCPModalForm())
      const newIcon = { type: 'emoji' as const, icon: '🎉', background: '#00FF00' }

      act(() => {
        result.current.actions.setAppIcon(newIcon)
      })

      expect(result.current.state.appIcon).toEqual(newIcon)
    })

    it('should toggle showAppIconPicker', () => {
      const { result } = renderHook(() => useMCPModalForm())

      expect(result.current.state.showAppIconPicker).toBe(false)

      act(() => {
        result.current.actions.setShowAppIconPicker(true)
      })

      expect(result.current.state.showAppIconPicker).toBe(true)
    })

    it('should reset icon to default', () => {
      const { result } = renderHook(() => useMCPModalForm())

      // Change icon first
      act(() => {
        result.current.actions.setAppIcon({ type: 'emoji', icon: '🎉', background: '#00FF00' })
      })

      expect(((result.current.state.appIcon) as AppIconEmojiSelection).icon).toBe('🎉')

      // Reset icon
      act(() => {
        result.current.actions.resetIcon()
      })

      expect(result.current.state.appIcon).toEqual({
        type: 'emoji',
        icon: '🔗',
        background: '#6366F1',
      })
    })
  })

  describe('handleUrlBlur', () => {
    it('should not fetch icon in edit mode (when data is provided)', async () => {
      const mockData = {
        id: 'test',
        name: 'Test',
        icon: { content: '🔗', background: '#6366F1' },
      } as unknown as ToolWithProvider
      const { result } = renderHook(() => useMCPModalForm(mockData))

      await act(async () => {
        await result.current.actions.handleUrlBlur('https://example.com')
      })

      // In edit mode, handleUrlBlur should return early
      expect(result.current.state.isFetchingIcon).toBe(false)
    })

    it('should not fetch icon for invalid URL', async () => {
      const { result } = renderHook(() => useMCPModalForm())

      await act(async () => {
        await result.current.actions.handleUrlBlur('not-a-valid-url')
      })

      expect(result.current.state.isFetchingIcon).toBe(false)
    })

    it('should handle error when icon fetch fails with error code', async () => {
      const { uploadRemoteFileInfo } = await import('@/service/common')
      const mockError = {
        json: vi.fn().mockResolvedValue({ code: 'UPLOAD_ERROR' }),
      }
      vi.mocked(uploadRemoteFileInfo).mockRejectedValueOnce(mockError)

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderHook(() => useMCPModalForm())

      await act(async () => {
        await result.current.actions.handleUrlBlur('https://example.com/mcp')
      })

      // Should have called console.error
      expect(consoleErrorSpy).toHaveBeenCalled()
      // isFetchingIcon should be reset to false after error
      expect(result.current.state.isFetchingIcon).toBe(false)

      consoleErrorSpy.mockRestore()
    })

    it('should handle error when icon fetch fails without error code', async () => {
      const { uploadRemoteFileInfo } = await import('@/service/common')
      const mockError = {
        json: vi.fn().mockResolvedValue({}),
      }
      vi.mocked(uploadRemoteFileInfo).mockRejectedValueOnce(mockError)

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderHook(() => useMCPModalForm())

      await act(async () => {
        await result.current.actions.handleUrlBlur('https://example.com/mcp')
      })

      // Should have called console.error
      expect(consoleErrorSpy).toHaveBeenCalled()
      // isFetchingIcon should be reset to false after error
      expect(result.current.state.isFetchingIcon).toBe(false)

      consoleErrorSpy.mockRestore()
    })

    it('should fetch icon successfully for valid URL in create mode', async () => {
      vi.mocked(await import('@/service/common').then(m => m.uploadRemoteFileInfo)).mockResolvedValueOnce({
        id: 'file123',
        name: 'icon.png',
        size: 1024,
        mime_type: 'image/png',
        url: 'https://example.com/files/file123/file-preview/icon.png',
      } as unknown as { id: string, name: string, size: number, mime_type: string, url: string })

      const { result } = renderHook(() => useMCPModalForm())

      await act(async () => {
        await result.current.actions.handleUrlBlur('https://example.com/mcp')
      })

      // Icon should be set to image type
      expect(result.current.state.appIcon.type).toBe('image')
      expect(((result.current.state.appIcon) as AppIconImageSelection).url).toBe('https://example.com/files/file123/file-preview/icon.png')
      expect(result.current.state.isFetchingIcon).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    // Base mock data with required icon field
    const baseMockData = {
      id: 'test',
      name: 'Test',
      icon: { content: '🔗', background: '#6366F1' },
    }

    it('should handle undefined configuration', () => {
      const mockData = { ...baseMockData } as unknown as ToolWithProvider

      const { result } = renderHook(() => useMCPModalForm(mockData))

      expect(result.current.state.timeout).toBe(30)
      expect(result.current.state.sseReadTimeout).toBe(300)
    })

    it('should handle undefined authentication', () => {
      const mockData = { ...baseMockData } as unknown as ToolWithProvider

      const { result } = renderHook(() => useMCPModalForm(mockData))

      expect(result.current.state.clientID).toBe('')
      expect(result.current.state.credentials).toBe('')
    })

    it('should handle undefined masked_headers', () => {
      const mockData = { ...baseMockData } as unknown as ToolWithProvider

      const { result } = renderHook(() => useMCPModalForm(mockData))

      expect(result.current.state.headers).toEqual([])
    })

    it('should handle undefined is_dynamic_registration (defaults to true)', () => {
      const mockData = { ...baseMockData } as unknown as ToolWithProvider

      const { result } = renderHook(() => useMCPModalForm(mockData))

      expect(result.current.state.isDynamicRegistration).toBe(true)
    })

    it('should handle string icon URL', () => {
      const mockData = {
        id: 'test',
        name: 'Test',
        icon: 'https://example.com/icon.png',
      } as unknown as ToolWithProvider

      const { result } = renderHook(() => useMCPModalForm(mockData))

      expect(result.current.state.appIcon.type).toBe('image')
      expect(((result.current.state.appIcon) as AppIconImageSelection).url).toBe('https://example.com/icon.png')
    })
  })
})
