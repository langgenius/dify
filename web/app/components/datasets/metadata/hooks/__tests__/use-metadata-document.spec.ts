import type { FullDocumentDetail } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createMetadataQueryWrapper } from '../../__tests__/query-wrapper'
import useMetadataDocument from '../use-metadata-document'

const { request } = vi.hoisted(() => ({
  request:
    vi.fn<(url: string, init: RequestInit, options: { request: Request }) => Promise<Response>>(),
}))
vi.mock('@/service/base', () => ({ request }))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContext: () => ({ dataset: { embedding_available: true } }),
}))
vi.mock('@/hooks/use-metadata', () => ({
  useMetadataMap: () => ({
    originInfo: { subFieldsMap: { language: { label: 'Language', inputType: 'select' } } },
    technicalParameters: { subFieldsMap: { hit_count: { label: 'Hits', inputType: 'text' } } },
  }),
  useLanguages: () => ({ en: 'English' }),
}))

const field = { id: 'field-1', name: 'category', type: 'string', value: 'one' } as const
const builtIn = { id: 'built-in', name: 'upload_date', type: 'time', value: 1700000000 } as const
const docDetail: Partial<FullDocumentDetail> = {
  id: 'doc-1',
  name: 'Metadata test',
  language: 'en',
  hit_count: 0,
}

describe('document metadata editing', () => {
  let fixture: ReturnType<typeof createMetadataQueryWrapper>

  beforeEach(() => {
    fixture = createMetadataQueryWrapper({
      documentMetadata: [field, builtIn],
      builtInEnabled: true,
    })
    request.mockImplementation((_url, _init, { request: req }) =>
      Promise.resolve(
        req.method === 'GET'
          ? Response.json({ id: 'doc-1', doc_metadata: [field, builtIn] })
          : new Response(null, { status: 204 }),
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
        useMetadataDocument({
          datasetId: 'ds-1',
          documentId: 'doc-1',
          docDetail: docDetail as FullDocumentDetail,
        }),
      { wrapper: fixture.wrapper },
    )

  it('separates built-in fields and restores confirmed values when editing is cancelled', () => {
    const { result } = renderEditor()
    expect(result.current.list).toEqual([field])
    expect(result.current.builtList).toEqual([builtIn])
    expect(result.current.builtInEnabled).toBe(true)
    act(() => result.current.startToEdit())
    act(() => result.current.setTempList([{ ...field, value: 'unsaved' }]))
    act(() => result.current.handleCancel())
    expect(result.current.tempList).toEqual([field])
    expect(result.current.isEdit).toBe(false)
    expect(result.current.originInfo[0]?.value).toBe('English')
    expect(result.current.technicalParameters[0]?.value).toBe(0)
  })

  it('avoids duplicate field selection', () => {
    const { result } = renderEditor()
    act(() => result.current.handleSelectMetaData(field))
    expect(result.current.tempList).toEqual([field])
  })

  it('creates a metadata field in the current dataset', async () => {
    const { result } = renderEditor()

    await act(async () => {
      await result.current.handleAddMetaData({ name: 'priority', type: 'number' })
    })

    const sent = request.mock.calls[0]![2].request
    expect(sent.method).toBe('POST')
    expect(new URL(sent.url).pathname).toBe('/console/api/datasets/ds-1/metadata')
    expect(await sent.json()).toEqual({ name: 'priority', type: 'number' })
  })

  it('writes only editable fields while preserving empty values and legacy boolean coercion', async () => {
    const { result } = renderEditor()
    act(() => result.current.startToEdit())
    act(() =>
      result.current.setTempList([
        { ...field, value: '' },
        { id: 'number', name: 'count', type: 'number', value: 0 },
        { id: 'cleared', name: 'cleared', type: 'string', value: null },
        { id: 'legacy', name: 'legacy', type: 'number', value: false },
      ]),
    )
    await act(async () => {
      await result.current.handleSave()
    })
    const sent = request.mock.calls[0]![2].request
    expect(sent.url).toContain('/datasets/ds-1/documents/metadata')
    expect(await sent.json()).toEqual({
      operation_data: [
        {
          document_id: 'doc-1',
          metadata_list: [
            { id: field.id, name: field.name, value: '' },
            { id: 'number', name: 'count', value: 0 },
            { id: 'cleared', name: 'cleared', value: null },
            { id: 'legacy', name: 'legacy', value: 0 },
          ],
        },
      ],
    })
    expect(result.current.isEdit).toBe(false)
  })

  it('preserves the draft after a failed save', async () => {
    request.mockResolvedValue(Response.json({ message: 'Permission denied' }, { status: 403 }))
    const { result } = renderEditor()
    act(() => result.current.startToEdit())
    act(() => result.current.setTempList([{ ...field, value: 'unsaved' }]))
    await act(async () => {
      await expect(result.current.handleSave()).rejects.toThrow()
    })
    expect(result.current.isEdit).toBe(true)
    expect(result.current.tempList).toEqual([{ ...field, value: 'unsaved' }])
  })
})
