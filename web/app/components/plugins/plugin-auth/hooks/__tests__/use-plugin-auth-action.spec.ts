import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createDeferred } from '@/test/deferred'
import { usePluginAuthAction } from '../../hooks/use-plugin-auth-action'
import { AuthCategory } from '../../types'

const mockDeletePluginCredential = vi.fn().mockResolvedValue({})
const mockSetPluginDefaultCredential = vi.fn().mockResolvedValue({})
const mockUpdatePluginCredential = vi.fn().mockResolvedValue({})
const toastMocks = vi.hoisted(() => ({
  call: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: Object.assign(toastMocks.call, {
    success: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'success', message, ...options }),
    ),
    error: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'error', message, ...options }),
    ),
    warning: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'warning', message, ...options }),
    ),
    info: vi.fn((message: string, options?: Record<string, unknown>) =>
      toastMocks.call({ type: 'info', message, ...options }),
    ),
    dismiss: toastMocks.dismiss,
    update: toastMocks.update,
    promise: toastMocks.promise,
  }),
}))
vi.mock('../../hooks/use-credential', () => ({
  useDeletePluginCredentialHook: () => ({
    mutateAsync: mockDeletePluginCredential,
  }),
  useSetPluginDefaultCredentialHook: () => ({
    mutateAsync: mockSetPluginDefaultCredential,
  }),
  useUpdatePluginCredentialHook: () => ({
    mutateAsync: mockUpdatePluginCredential,
  }),
}))

const pluginPayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('usePluginAuthAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open and close confirm dialog', () => {
    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.openConfirm('cred-1')
    })
    expect(result.current.deleteCredentialId).toBe('cred-1')

    act(() => {
      result.current.closeConfirm()
    })
    expect(result.current.deleteCredentialId).toBeNull()
  })

  it('opens deletion confirmation for the credential being edited', () => {
    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.handleEdit('cred-1', { key: 'value' })
    })
    expect(result.current.editValues).toEqual({ key: 'value' })

    act(() => {
      result.current.handleRemove()
    })
    expect(result.current.deleteCredentialId).toBe('cred-1')
  })

  it('should handle confirm delete', async () => {
    const mockOnUpdate = vi.fn()
    const { result } = renderHook(() => usePluginAuthAction(pluginPayload, mockOnUpdate), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.openConfirm('cred-1')
    })

    await act(async () => {
      await result.current.handleConfirm()
    })

    expect(mockDeletePluginCredential).toHaveBeenCalledWith({ credential_id: 'cred-1' })
    expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    expect(mockOnUpdate).toHaveBeenCalled()
    expect(result.current.deleteCredentialId).toBeNull()
  })

  it('should handle set default credential', async () => {
    const mockOnUpdate = vi.fn()
    const { result } = renderHook(() => usePluginAuthAction(pluginPayload, mockOnUpdate), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.handleSetDefault('cred-1')
    })

    expect(mockSetPluginDefaultCredential).toHaveBeenCalledWith('cred-1')
    expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    expect(mockOnUpdate).toHaveBeenCalled()
  })

  it('should handle rename credential', async () => {
    const mockOnUpdate = vi.fn()
    const { result } = renderHook(() => usePluginAuthAction(pluginPayload, mockOnUpdate), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.handleRename({
        credential_id: 'cred-1',
        name: 'New Name',
      })
    })

    expect(mockUpdatePluginCredential).toHaveBeenCalledWith({
      credential_id: 'cred-1',
      name: 'New Name',
    })
    expect(toastMocks.call).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    expect(mockOnUpdate).toHaveBeenCalled()
  })

  it('prevents concurrent actions until the pending deletion completes', async () => {
    const deletion = createDeferred<object>()
    mockDeletePluginCredential.mockReturnValueOnce(deletion.promise)
    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })
    act(() => result.current.openConfirm('cred-1'))
    let pending: Promise<void>
    act(() => {
      pending = result.current.handleConfirm()
    })
    expect(result.current.doingAction).toBe(true)

    await act(async () => {
      await result.current.handleConfirm()
      await result.current.handleSetDefault('cred-2')
      await result.current.handleRename({ credential_id: 'cred-2', name: 'New name' })
    })
    expect(mockDeletePluginCredential).toHaveBeenCalledExactlyOnceWith({ credential_id: 'cred-1' })
    expect(mockSetPluginDefaultCredential).not.toHaveBeenCalled()
    expect(mockUpdatePluginCredential).not.toHaveBeenCalled()

    await act(async () => {
      deletion.resolve({})
      await pending
    })
    expect(result.current.doingAction).toBe(false)
    expect(result.current.deleteCredentialId).toBeNull()
  })

  it('should handle confirm without pending credential ID', async () => {
    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.handleConfirm()
    })

    expect(mockDeletePluginCredential).not.toHaveBeenCalled()
    expect(result.current.deleteCredentialId).toBeNull()
  })
})
