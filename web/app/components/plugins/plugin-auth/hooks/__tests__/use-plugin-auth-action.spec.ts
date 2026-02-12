import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePluginAuthAction } from '../../hooks/use-plugin-auth-action'
import { AuthCategory } from '../../types'

const mockDeletePluginCredential = vi.fn().mockResolvedValue({})
const mockSetPluginDefaultCredential = vi.fn().mockResolvedValue({})
const mockUpdatePluginCredential = vi.fn().mockResolvedValue({})
const mockNotify = vi.fn()

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
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

  it('should initialize with default state', () => {
    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    expect(result.current.doingAction).toBe(false)
    expect(result.current.deleteCredentialId).toBeNull()
    expect(result.current.editValues).toBeNull()
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

  it('should handle edit action', () => {
    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    const editVals = { key: 'value' }
    act(() => {
      result.current.handleEdit('cred-1', editVals)
    })
    expect(result.current.editValues).toEqual(editVals)
  })

  it('should handle remove action by setting deleteCredentialId', () => {
    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.handleEdit('cred-1', { key: 'value' })
    })

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
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
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
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
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
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    expect(mockOnUpdate).toHaveBeenCalled()
  })

  it('should prevent concurrent actions during doingAction', async () => {
    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.handleSetDoingAction(true)
    })
    expect(result.current.doingAction).toBe(true)

    act(() => {
      result.current.openConfirm('cred-1')
    })
    await act(async () => {
      await result.current.handleConfirm()
    })
    expect(mockDeletePluginCredential).not.toHaveBeenCalled()
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
