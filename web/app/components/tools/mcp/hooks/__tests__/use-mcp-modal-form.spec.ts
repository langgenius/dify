import type { ImageIcon } from '@/app/components/base/icon-picker'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { MCPAuthMethod } from '@/app/components/tools/types'
import { toast } from '@/app/notifications'
import { uploadRemoteFileInfo } from '@/service/common'
import { createHttpError } from '@/service/http-error'
import { isValidServerID, isValidUrl, useMCPModalForm } from '../use-mcp-modal-form'

// Mock the API service
vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

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
          Authorization: '***',
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
        expect(result.current.state.headers).toEqual([
          { id: expect.any(String), key: 'Authorization', value: '***' },
          { id: expect.any(String), key: 'X-Custom', value: 'value' },
        ])
        expect(result.current.state.appIcon).toEqual({
          type: 'emoji',
          icon: '🚀',
          background: '#FF0000',
        })
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

      it('uses the default icon when the existing URL has no uploaded file id', () => {
        const { result } = renderHook(() =>
          useMCPModalForm({ ...mockDataWithImageIcon, icon: 'https://example.com/icon.png' }),
        )

        expect(result.current.state.appIcon).toEqual({
          type: 'emoji',
          icon: '🔗',
          background: '#6366F1',
        })
      })

      it('should initialize image icon from string URL', () => {
        const { result } = renderHook(() => useMCPModalForm(mockDataWithImageIcon))

        expect(result.current.state.appIcon.type).toBe('image')
        expect((result.current.state.appIcon as ImageIcon).url).toBe(
          'https://example.com/files/abc123/file-preview/icon.png',
        )
        expect((result.current.state.appIcon as ImageIcon).fileId).toBe('abc123')
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

      expect(uploadRemoteFileInfo).not.toHaveBeenCalled()
      expect(result.current.state.isFetchingIcon).toBe(false)
    })

    it('should not fetch icon for invalid URL', async () => {
      const { result } = renderHook(() => useMCPModalForm())

      await act(async () => {
        await result.current.actions.handleUrlBlur('not-a-valid-url')
      })
      expect(uploadRemoteFileInfo).not.toHaveBeenCalled()
      expect(result.current.state.isFetchingIcon).toBe(false)
    })

    it('uses the uploaded file id independently of the preview URL format', async () => {
      const { uploadRemoteFileInfo } = await import('@/service/common')
      vi.mocked(uploadRemoteFileInfo).mockResolvedValueOnce({
        id: 'uploaded-icon-id',
        name: 'icon.png',
        size: 1024,
        mime_type: 'image/png',
        url: 'https://example.com/icon.png',
      })
      const { result } = renderHook(() => useMCPModalForm())

      await act(async () => {
        await result.current.actions.handleUrlBlur('https://api.example.co.uk/mcp')
      })

      expect(uploadRemoteFileInfo).toHaveBeenCalledWith(
        'https://www.google.com/s2/favicons?domain=example.co.uk&sz=128',
        undefined,
        true,
      )
      expect(result.current.state.appIcon).toEqual({
        type: 'image',
        fileId: 'uploaded-icon-id',
        url: 'https://example.com/icon.png',
      })
    })

    it.each([
      {
        name: 'HTTP failure',
        error: createHttpError(new Response(null, { status: 400 }), {
          code: 'UPLOAD_ERROR',
          message: 'Remote icon upload failed',
        }),
        message: 'Remote icon upload failed',
      },
      {
        name: 'network failure',
        error: new TypeError('Failed to fetch'),
        message: 'Failed to fetch',
      },
    ])('shows the error message for an icon $name', async ({ error, message }) => {
      const { uploadRemoteFileInfo } = await import('@/service/common')
      vi.mocked(uploadRemoteFileInfo).mockRejectedValueOnce(error)
      const warningSpy = vi.spyOn(toast, 'warning').mockReturnValue('icon-upload-warning')
      const { result } = renderHook(() => useMCPModalForm())

      await act(async () => {
        await result.current.actions.handleUrlBlur('https://example.com/mcp')
      })

      expect(warningSpy).toHaveBeenCalledWith(message)
      expect(result.current.state.isFetchingIcon).toBe(false)
    })

    it('should ignore stale blur when a newer blur starts before fetch completes', async () => {
      const { uploadRemoteFileInfo } = await import('@/service/common')
      let resolveFirstUpload: (value: {
        id: string
        name: string
        size: number
        mime_type: string
        url: string
      }) => void
      const firstUpload = new Promise<{
        id: string
        name: string
        size: number
        mime_type: string
        url: string
      }>((resolve) => {
        resolveFirstUpload = resolve
      })

      vi.mocked(uploadRemoteFileInfo).mockImplementation((remoteIcon) => {
        if (String(remoteIcon).includes('domain=example.com')) return firstUpload
        return Promise.resolve({
          id: 'file456',
          name: 'icon2.png',
          size: 1024,
          mime_type: 'image/png',
          url: 'https://example.com/files/file456/file-preview/icon2.png',
        } as unknown as { id: string; name: string; size: number; mime_type: string; url: string })
      })

      const { result } = renderHook(() => useMCPModalForm())

      let firstBlur: Promise<void>
      act(() => {
        firstBlur = result.current.actions.handleUrlBlur('https://first.example.com/mcp')
      })
      await waitFor(() =>
        expect(uploadRemoteFileInfo).toHaveBeenCalledWith(
          'https://www.google.com/s2/favicons?domain=example.com&sz=128',
          undefined,
          true,
        ),
      )

      await act(async () => {
        await result.current.actions.handleUrlBlur('https://second.example.org/mcp')
      })

      resolveFirstUpload!({
        id: 'file123',
        name: 'icon.png',
        size: 1024,
        mime_type: 'image/png',
        url: 'https://example.com/files/file123/file-preview/icon.png',
      })
      await act(async () => {
        await firstBlur
      })

      expect(result.current.state.appIcon.type).toBe('image')
      expect((result.current.state.appIcon as ImageIcon).url).toBe(
        'https://example.com/files/file456/file-preview/icon2.png',
      )
      expect(result.current.state.isFetchingIcon).toBe(false)

      vi.mocked(uploadRemoteFileInfo).mockReset()
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
  })

  // M3 — Forward-user-identity toggle (PR #36840). The hook stores a bool,
  // hydrates it from data.identity_mode (true iff non-"off"), and exposes a
  // setter.
})
