import type { MetadataItemWithEdit } from '../../types'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createMetadataQueryWrapper } from '../../__tests__/query-wrapper'
import useBatchEditDocumentMetadata from '../use-batch-edit-document-metadata'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
vi.mock('@/service/base', () => ({ request }))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const text = { id: 'field-1', name: 'category', type: 'string', value: 'one' } as const
const number = { id: 'field-2', name: 'count', type: 'number', value: 0 } as const
const docs = [
  {
    id: 'doc-1',
    doc_metadata: [text, number, { id: 'built-in', name: 'source', type: 'string', value: 'file' }],
  },
  { id: 'doc-2', doc_metadata: [{ ...text, value: 'two' }] },
] as SimpleDocumentDetail[]

describe('batch metadata editing', () => {
  let fixture: ReturnType<typeof createMetadataQueryWrapper>
  const onUpdate = vi.fn()

  beforeEach(() => {
    fixture = createMetadataQueryWrapper()
    request.mockResolvedValue(new Response(null, { status: 204 }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    fixture.queryClient.clear()
    vi.restoreAllMocks()
  })

  const renderEditor = (selectedDocumentIds?: string[]) =>
    renderHook(
      () =>
        useBatchEditDocumentMetadata({
          datasetId: 'ds-1',
          docList: docs,
          selectedDocumentIds,
          onUpdate,
        }),
      { wrapper: fixture.wrapper },
    )

  it('groups differing values and leaves built-in fields out of the editable draft', () => {
    const { result } = renderEditor()
    expect(result.current.originalList).toEqual([
      { ...text, value: null, isMultipleValue: true },
      { ...number, isMultipleValue: false },
    ])
  })

  it('writes selected documents including off-page documents with partial updates', async () => {
    const { result } = renderEditor(['doc-1', 'doc-off-page'])
    const edited: MetadataItemWithEdit[] = [
      { ...text, value: '', updateType: 'changeValue', isUpdated: true },
    ]
    const added = [{ id: 'field-3', name: 'cleared', type: 'string' as const, value: null }]
    act(() => result.current.showEditModal())
    await act(async () => {
      await result.current.handleSave(edited, added, true)
    })
    const sent = request.mock.calls[0]![2].request
    expect(sent.method).toBe('POST')
    expect(sent.url).toContain('/datasets/ds-1/documents/metadata')
    expect(await sent.json()).toEqual({
      operation_data: [
        {
          document_id: 'doc-1',
          partial_update: false,
          metadata_list: [
            { id: text.id, name: text.name, value: '' },
            { id: 'field-3', name: 'cleared', value: null },
          ],
        },
        {
          document_id: 'doc-off-page',
          partial_update: true,
          metadata_list: [
            { id: 'field-3', name: 'cleared', value: null },
            { id: text.id, name: text.name, value: '' },
          ],
        },
      ],
    })
    expect(result.current.isShowEditModal).toBe(false)
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'applies a missing field only when apply-to-all is %s',
    async (applyToAll) => {
      const { result } = renderEditor()
      const edited: MetadataItemWithEdit[] = [text, { ...number, updateType: 'changeValue' }]
      await act(async () => {
        await result.current.handleSave(edited, [], applyToAll)
      })
      const body = await request.mock.calls[0]![2].request.json()
      expect(body.operation_data[0].metadata_list).toEqual([
        { id: text.id, name: text.name, value: text.value },
        { id: number.id, name: number.name, value: 0 },
      ])
      expect(body.operation_data[1].metadata_list).toEqual([
        { id: text.id, name: text.name, value: 'two' },
        ...(applyToAll ? [{ id: number.id, name: number.name, value: 0 }] : []),
      ])
    },
  )

  it('does not add a multiple-value field to an off-page document', async () => {
    const { result } = renderEditor(['off-page'])
    await act(async () => {
      await result.current.handleSave([{ ...text, value: null, isMultipleValue: true }], [], true)
    })
    expect(await request.mock.calls[0]![2].request.json()).toEqual({
      operation_data: [{ document_id: 'off-page', partial_update: true, metadata_list: [] }],
    })
  })

  it('keeps the editor open after a rejected write and does not report an update', async () => {
    request.mockResolvedValue(Response.json({ message: 'Write failed' }, { status: 500 }))
    const { result } = renderEditor()
    act(() => result.current.showEditModal())
    await act(async () => {
      await expect(result.current.handleSave([], [], false)).rejects.toThrow()
    })
    expect(result.current.isShowEditModal).toBe(true)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
