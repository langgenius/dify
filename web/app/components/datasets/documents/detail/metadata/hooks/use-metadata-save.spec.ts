import type { MetadataState } from './use-metadata-editor'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMetadataSave } from './use-metadata-save'

const mockNotify = vi.fn()
const mockModifyDocMetadata = vi.fn()

vi.mock('use-context-selector', async (importOriginal) => {
  const actual = await importOriginal() as object
  return {
    ...actual,
    useContext: () => ({ notify: mockNotify }),
  }
})

vi.mock('@/service/datasets', () => ({
  modifyDocMetadata: (params: unknown) => mockModifyDocMetadata(params),
}))

describe('useMetadataSave', () => {
  const defaultOptions = {
    datasetId: 'dataset-1',
    documentId: 'doc-1',
    metadataParams: {
      documentType: 'book',
      metadata: { title: 'Test Title' },
    } as MetadataState,
    doc_type: 'book',
    onSuccess: vi.fn(),
    onUpdate: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockModifyDocMetadata.mockResolvedValue({})
  })

  describe('initial state', () => {
    it('should initialize with saveLoading false', () => {
      const { result } = renderHook(() =>
        useMetadataSave(defaultOptions),
      )

      expect(result.current.saveLoading).toBe(false)
    })

    it('should return handleSave function', () => {
      const { result } = renderHook(() =>
        useMetadataSave(defaultOptions),
      )

      expect(typeof result.current.handleSave).toBe('function')
    })
  })

  describe('handleSave', () => {
    it('should call modifyDocMetadata with correct params', async () => {
      const { result } = renderHook(() =>
        useMetadataSave(defaultOptions),
      )

      await act(async () => {
        await result.current.handleSave()
      })

      expect(mockModifyDocMetadata).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        documentId: 'doc-1',
        body: {
          doc_type: 'book',
          doc_metadata: { title: 'Test Title' },
        },
      })
    })

    it('should use metadataParams.documentType over doc_type', async () => {
      const options = {
        ...defaultOptions,
        metadataParams: {
          documentType: 'personal_document',
          metadata: { name: 'Test' },
        } as MetadataState,
        doc_type: 'book',
      }
      const { result } = renderHook(() =>
        useMetadataSave(options),
      )

      await act(async () => {
        await result.current.handleSave()
      })

      expect(mockModifyDocMetadata).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        documentId: 'doc-1',
        body: {
          doc_type: 'personal_document',
          doc_metadata: { name: 'Test' },
        },
      })
    })

    it('should set saveLoading to true during save', async () => {
      let resolvePromise: () => void
      mockModifyDocMetadata.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = () => resolve({})
        }),
      )

      const { result } = renderHook(() =>
        useMetadataSave(defaultOptions),
      )

      act(() => {
        result.current.handleSave()
      })

      await waitFor(() => {
        expect(result.current.saveLoading).toBe(true)
      })

      await act(async () => {
        resolvePromise!()
      })

      await waitFor(() => {
        expect(result.current.saveLoading).toBe(false)
      })
    })

    it('should call onSuccess and onUpdate on successful save', async () => {
      const onSuccess = vi.fn()
      const onUpdate = vi.fn()
      const { result } = renderHook(() =>
        useMetadataSave({ ...defaultOptions, onSuccess, onUpdate }),
      )

      await act(async () => {
        await result.current.handleSave()
      })

      expect(onSuccess).toHaveBeenCalled()
      expect(onUpdate).toHaveBeenCalled()
    })

    it('should show success toast on successful save', async () => {
      const { result } = renderHook(() =>
        useMetadataSave(defaultOptions),
      )

      await act(async () => {
        await result.current.handleSave()
      })

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: expect.any(String),
      })
    })

    it('should show error toast on failed save', async () => {
      mockModifyDocMetadata.mockRejectedValue(new Error('Save failed'))

      const { result } = renderHook(() =>
        useMetadataSave(defaultOptions),
      )

      await act(async () => {
        await result.current.handleSave()
      })

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.any(String),
      })
    })

    it('should still call onUpdate and onSuccess even on error', async () => {
      mockModifyDocMetadata.mockRejectedValue(new Error('Save failed'))
      const onSuccess = vi.fn()
      const onUpdate = vi.fn()

      const { result } = renderHook(() =>
        useMetadataSave({ ...defaultOptions, onSuccess, onUpdate }),
      )

      await act(async () => {
        await result.current.handleSave()
      })

      expect(onUpdate).toHaveBeenCalled()
      expect(onSuccess).toHaveBeenCalled()
    })

    it('should use empty doc_type when both are empty', async () => {
      const options = {
        ...defaultOptions,
        metadataParams: {
          documentType: '',
          metadata: {},
        } as MetadataState,
        doc_type: '',
      }
      const { result } = renderHook(() =>
        useMetadataSave(options),
      )

      await act(async () => {
        await result.current.handleSave()
      })

      expect(mockModifyDocMetadata).toHaveBeenCalledWith({
        datasetId: 'dataset-1',
        documentId: 'doc-1',
        body: {
          doc_type: '',
          doc_metadata: {},
        },
      })
    })
  })
})
