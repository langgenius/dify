import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createMetadataQueryWrapper } from '../../__tests__/query-wrapper'
import { isShowManageMetadataLocalStorageKey } from '../../types'
import useEditDatasetMetadata from '../use-edit-dataset-metadata'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
vi.mock('@/service/base', () => ({ request }))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const field = { id: 'field-1', name: 'category', type: 'string', count: 1 } as const

describe('dataset metadata editing', () => {
  let fixture: ReturnType<typeof createMetadataQueryWrapper>

  beforeEach(() => {
    fixture = createMetadataQueryWrapper({ fields: [field] })
    localStorage.removeItem(isShowManageMetadataLocalStorageKey)
    request.mockImplementation((_url, _init, { request: req }) =>
      Promise.resolve(
        req.method === 'GET'
          ? Response.json({ doc_metadata: [field], built_in_field_enabled: false })
          : req.method === 'DELETE' || req.url.includes('/built-in/')
            ? new Response(null, { status: 204 })
            : Response.json(field, { status: req.method === 'POST' ? 201 : 200 }),
      ),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    fixture.queryClient.clear()
    vi.restoreAllMocks()
  })

  const renderEditor = () =>
    renderHook(
      () =>
        useEditDatasetMetadata({
          datasetId: 'ds-1',
        }),
      { wrapper: fixture.wrapper },
    )

  it('opens metadata management once after navigation and displays cached fields', () => {
    localStorage.setItem(isShowManageMetadataLocalStorageKey, 'true')
    const { result } = renderEditor()
    expect(result.current.isShowEditModal).toBe(true)
    expect(result.current.datasetMetaData).toEqual([field])
    expect(localStorage.getItem(isShowManageMetadataLocalStorageKey)).toBeNull()
    act(() => result.current.hideEditModal())
    expect(result.current.isShowEditModal).toBe(false)
  })

  it.each(['', 'Invalid Name'])(
    'rejects invalid field name %j without sending a write',
    async (name) => {
      const { result } = renderEditor()
      await act(async () => {
        await expect(result.current.handleAddMetaData({ name, type: 'string' })).rejects.toThrow()
        await expect(result.current.handleRename({ ...field, name })).rejects.toThrow()
      })
      expect(request).not.toHaveBeenCalled()
    },
  )

  it('waits for field creation before resolving the picker submission', async () => {
    let resolve!: (response: Response) => void
    const promise = new Promise<Response>((res) => {
      resolve = res
    })
    request.mockImplementation((_url, _init, { request: req }) =>
      req.method === 'POST'
        ? promise
        : Promise.resolve(Response.json({ doc_metadata: [field], built_in_field_enabled: false })),
    )
    const { result } = renderEditor()
    let settled = false
    let save: Promise<void>
    act(() => {
      save = result.current.handleAddMetaData({ name: 'category', type: 'string' }).then(() => {
        settled = true
      })
    })
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    expect(await request.mock.calls[0]![2].request.json()).toEqual({
      name: 'category',
      type: 'string',
    })
    await act(async () => {
      resolve(Response.json(field, { status: 201 }))
      await save
    })
    expect(settled).toBe(true)
  })

  it.each(['rename', 'delete'] as const)(
    '%s sends the generated endpoint request',
    async (action) => {
      const { result } = renderEditor()
      await act(async () => {
        if (action === 'rename') await result.current.handleRename({ ...field, name: 'renamed' })
        else await result.current.handleDeleteMetaData(field.id)
      })
      const sent = request.mock.calls[0]![2].request
      expect(sent.url).toContain('/datasets/ds-1/metadata/field-1')
      expect(sent.method).toBe(action === 'rename' ? 'PATCH' : 'DELETE')
      if (action === 'rename') expect(await sent.json()).toEqual({ name: 'renamed' })
    },
  )

  it('propagates a rejected rename to the editor', async () => {
    request.mockResolvedValue(Response.json({ message: 'Permission denied' }, { status: 403 }))
    const { result } = renderEditor()
    await act(async () => {
      await expect(result.current.handleRename({ ...field, name: 'renamed' })).rejects.toThrow()
    })
  })

  it('uses both built-in actions and keeps the last confirmed status after a failure', async () => {
    const { result } = renderEditor()
    await act(async () => {
      await result.current.setBuiltInEnabled(true)
    })
    expect(result.current.builtInEnabled).toBe(true)
    expect(request.mock.calls[0]![2].request.url).toContain('/metadata/built-in/enable')
    request.mockResolvedValue(Response.json({ message: 'Permission denied' }, { status: 403 }))
    await act(async () => {
      await expect(result.current.setBuiltInEnabled(false)).rejects.toThrow()
    })
    expect(result.current.builtInEnabled).toBe(true)
    expect(request.mock.lastCall![2].request.url).toContain('/metadata/built-in/disable')
  })
})
