import type { ToolWithProvider } from '@/app/components/workflow/types'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MCPAuthMethod } from '@/app/components/tools/types'
import { uploadRemoteFileInfo } from '@/service/common'
import { isValidServerID, isValidUrl, useMCPModalForm } from '../use-mcp-modal-form'

const mockToastWarning = vi.hoisted(() => vi.fn())

vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    warning: mockToastWarning,
  },
}))

const createEditData = (overrides: Partial<ToolWithProvider> = {}) =>
  ({
    id: 'server-1',
    name: 'Research server',
    server_url: 'https://example.com/mcp',
    server_identifier: 'research-server',
    icon: { content: '🚀', background: '#FF0000' },
    configuration: {
      timeout: 60,
      sse_read_timeout: 600,
    },
    masked_headers: {
      Authorization: '***',
      'X-Workspace': 'workspace-1',
    },
    is_dynamic_registration: false,
    authentication: {
      client_id: 'client-123',
      client_secret: 'secret-456',
    },
    identity_mode: 'idp_token',
    ...overrides,
  }) as unknown as ToolWithProvider

describe('MCP modal form validation', () => {
  it.each([
    ['http://example.com', true],
    ['https://example.com/path?transport=sse', true],
    ['ftp://example.com', false],
    ['not-a-url', false],
    ['', false],
  ])('validates URL protocol for %s', (value, expected) => {
    expect(isValidUrl(value)).toBe(expected)
  })

  it.each([
    ['server', true],
    ['server_123-test', true],
    ['abcdefghijklmnopqrstuvwx', true],
    ['Server', false],
    ['server id', false],
    ['server@id', false],
    ['abcdefghijklmnopqrstuvwxy', false],
    ['', false],
  ])('validates the server identifier contract for %s', (value, expected) => {
    expect(isValidServerID(value)).toBe(expected)
  })
})

describe('useMCPModalForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes the create form with product defaults', () => {
    const { result } = renderHook(() => useMCPModalForm())

    expect(result.current).toMatchObject({
      formKey: 'create',
      isCreate: true,
      originalServerUrl: undefined,
      originalServerID: undefined,
      state: {
        url: '',
        name: '',
        appIcon: { type: 'emoji', icon: '🔗', background: '#6366F1' },
        showAppIconPicker: false,
        serverIdentifier: '',
        timeout: 30,
        sseReadTimeout: 300,
        headers: [],
        isFetchingIcon: false,
        authMethod: MCPAuthMethod.authentication,
        isDynamicRegistration: true,
        clientID: '',
        credentials: '',
        forwardUserIdentity: false,
      },
    })
  })

  it('hydrates every persisted edit value used by the modal', () => {
    const { result } = renderHook(() => useMCPModalForm(createEditData()))

    expect(result.current.formKey).toBe('server-1')
    expect(result.current.isCreate).toBe(false)
    expect(result.current.originalServerUrl).toBe('https://example.com/mcp')
    expect(result.current.originalServerID).toBe('research-server')
    expect(result.current.state).toMatchObject({
      url: 'https://example.com/mcp',
      name: 'Research server',
      appIcon: { type: 'emoji', icon: '🚀', background: '#FF0000' },
      serverIdentifier: 'research-server',
      timeout: 60,
      sseReadTimeout: 600,
      authMethod: MCPAuthMethod.authentication,
      isDynamicRegistration: false,
      clientID: 'client-123',
      credentials: 'secret-456',
      forwardUserIdentity: true,
    })
    expect(result.current.state.headers.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'Authorization', value: '***' },
      { key: 'X-Workspace', value: 'workspace-1' },
    ])
  })

  it('extracts the file ID from a persisted image icon URL', () => {
    const { result } = renderHook(() =>
      useMCPModalForm(
        createEditData({
          icon: 'https://example.com/files/icon-file-id/file-preview/icon.png',
        }),
      ),
    )

    expect(result.current.state.appIcon).toEqual({
      type: 'image',
      url: 'https://example.com/files/icon-file-id/file-preview/icon.png',
      fileId: 'icon-file-id',
    })
  })

  it.each([
    { data: undefined, url: 'not-a-url', caseName: 'an invalid create URL' },
    { data: createEditData(), url: 'https://example.com/mcp', caseName: 'edit mode' },
  ])('does not fetch a favicon for $caseName', async ({ data, url }) => {
    const { result } = renderHook(() => useMCPModalForm(data))

    await act(async () => {
      await result.current.actions.handleUrlBlur(url)
    })

    expect(uploadRemoteFileInfo).not.toHaveBeenCalled()
    expect(result.current.state.isFetchingIcon).toBe(false)
  })

  it('fetches a domain favicon and stores the returned image contract', async () => {
    vi.mocked(uploadRemoteFileInfo).mockResolvedValue({
      url: 'https://example.com/files/file-123/file-preview/icon.png',
    } as Awaited<ReturnType<typeof uploadRemoteFileInfo>>)
    const { result } = renderHook(() => useMCPModalForm())

    await act(async () => {
      await result.current.actions.handleUrlBlur('https://docs.example.com/mcp')
    })

    expect(uploadRemoteFileInfo).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=example.com&sz=128',
      undefined,
      true,
    )
    expect(result.current.state.appIcon).toEqual({
      type: 'image',
      url: 'https://example.com/files/file-123/file-preview/icon.png',
      fileId: 'file-123',
    })
    expect(result.current.state.isFetchingIcon).toBe(false)
  })

  it('warns the user and preserves the default icon when favicon upload fails', async () => {
    vi.mocked(uploadRemoteFileInfo).mockRejectedValue(new Error('Network unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result } = renderHook(() => useMCPModalForm())

    await act(async () => {
      await result.current.actions.handleUrlBlur('https://example.com/mcp')
    })

    expect(mockToastWarning).toHaveBeenCalledWith('Network unavailable')
    expect(result.current.state.appIcon).toEqual({
      type: 'emoji',
      icon: '🔗',
      background: '#6366F1',
    })
    expect(result.current.state.isFetchingIcon).toBe(false)
    consoleError.mockRestore()
  })
})
