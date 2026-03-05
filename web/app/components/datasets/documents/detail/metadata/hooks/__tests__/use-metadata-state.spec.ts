import type { ReactNode } from 'react'
import type { FullDocumentDetail } from '@/models/datasets'
import { act, renderHook } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ToastContext } from '@/app/components/base/toast'

import { useMetadataState } from '../use-metadata-state'

const { mockNotify, mockModifyDocMetadata } = vi.hoisted(() => ({
  mockNotify: vi.fn(),
  mockModifyDocMetadata: vi.fn(),
}))

vi.mock('../../../context', () => ({
  useDocumentContext: (selector: (state: { datasetId: string, documentId: string }) => unknown) =>
    selector({ datasetId: 'ds-1', documentId: 'doc-1' }),
}))

vi.mock('@/service/datasets', () => ({
  modifyDocMetadata: (...args: unknown[]) => mockModifyDocMetadata(...args),
}))

vi.mock('@/hooks/use-metadata', () => ({ useMetadataMap: () => ({}) }))

vi.mock('@/utils', () => ({
  asyncRunSafe: async (promise: Promise<unknown>) => {
    try {
      return [null, await promise]
    }
    catch (e) { return [e] }
  },
}))

// Wrapper that provides ToastContext with the mock notify function
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(ToastContext.Provider, { value: { notify: mockNotify, close: vi.fn() }, children })

type DocDetail = Parameters<typeof useMetadataState>[0]['docDetail']

const makeDoc = (overrides: Partial<FullDocumentDetail> = {}): DocDetail =>
  ({ doc_type: 'book', doc_metadata: { title: 'Test Book', author: 'Author' }, ...overrides } as DocDetail)

describe('useMetadataState', () => {
  // Verify all metadata editing workflows using a stable docDetail reference
  it('should manage the full metadata editing lifecycle', async () => {
    mockModifyDocMetadata.mockResolvedValue({ result: 'ok' })
    const onUpdate = vi.fn()

    // IMPORTANT: Create a stable reference outside the render callback
    // to prevent useEffect infinite loops on docDetail?.doc_metadata
    const stableDocDetail = makeDoc()

    const { result } = renderHook(() =>
      useMetadataState({ docDetail: stableDocDetail, onUpdate }), { wrapper })

    // --- Initialization ---
    expect(result.current.docType).toBe('book')
    expect(result.current.editStatus).toBe(false)
    expect(result.current.showDocTypes).toBe(false)
    expect(result.current.metadataParams.documentType).toBe('book')
    expect(result.current.metadataParams.metadata).toEqual({ title: 'Test Book', author: 'Author' })

    // --- Enable editing ---
    act(() => {
      result.current.enableEdit()
    })
    expect(result.current.editStatus).toBe(true)

    // --- Update individual field ---
    act(() => {
      result.current.updateMetadataField('title', 'Modified Title')
    })
    expect(result.current.metadataParams.metadata.title).toBe('Modified Title')
    expect(result.current.metadataParams.metadata.author).toBe('Author')

    // --- Cancel edit restores original data ---
    act(() => {
      result.current.cancelEdit()
    })
    expect(result.current.metadataParams.metadata.title).toBe('Test Book')
    expect(result.current.editStatus).toBe(false)

    // --- Doc type selection: cancel restores previous ---
    act(() => {
      result.current.enableEdit()
    })
    act(() => {
      result.current.setShowDocTypes(true)
    })
    act(() => {
      result.current.setTempDocType('web_page')
    })
    act(() => {
      result.current.cancelDocType()
    })
    expect(result.current.tempDocType).toBe('book')
    expect(result.current.showDocTypes).toBe(false)

    // --- Confirm different doc type clears metadata ---
    act(() => {
      result.current.setShowDocTypes(true)
    })
    act(() => {
      result.current.setTempDocType('web_page')
    })
    act(() => {
      result.current.confirmDocType()
    })
    expect(result.current.metadataParams.documentType).toBe('web_page')
    expect(result.current.metadataParams.metadata).toEqual({})

    // --- Save succeeds ---
    await act(async () => {
      await result.current.saveMetadata()
    })
    expect(mockModifyDocMetadata).toHaveBeenCalledWith({
      datasetId: 'ds-1',
      documentId: 'doc-1',
      body: { doc_type: 'web_page', doc_metadata: {} },
    })
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    expect(onUpdate).toHaveBeenCalled()
    expect(result.current.editStatus).toBe(false)
    expect(result.current.saveLoading).toBe(false)

    // --- Save failure notifies error ---
    mockNotify.mockClear()
    mockModifyDocMetadata.mockRejectedValue(new Error('fail'))
    act(() => {
      result.current.enableEdit()
    })
    await act(async () => {
      await result.current.saveMetadata()
    })
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  // Verify empty doc type starts in editing mode
  it('should initialize in editing mode when no doc type exists', () => {
    const stableDocDetail = makeDoc({ doc_type: '' as FullDocumentDetail['doc_type'], doc_metadata: {} as FullDocumentDetail['doc_metadata'] })
    const { result } = renderHook(() => useMetadataState({ docDetail: stableDocDetail }), { wrapper })

    expect(result.current.docType).toBe('')
    expect(result.current.editStatus).toBe(true)
    expect(result.current.showDocTypes).toBe(true)
  })

  // Verify "others" normalization
  it('should normalize "others" doc_type to empty string', () => {
    const stableDocDetail = makeDoc({ doc_type: 'others' as FullDocumentDetail['doc_type'] })
    const { result } = renderHook(() => useMetadataState({ docDetail: stableDocDetail }), { wrapper })

    expect(result.current.docType).toBe('')
  })

  // Verify undefined docDetail handling
  it('should handle undefined docDetail gracefully', () => {
    const { result } = renderHook(() => useMetadataState({ docDetail: undefined }), { wrapper })

    expect(result.current.docType).toBe('')
    expect(result.current.editStatus).toBe(true)
  })
})
