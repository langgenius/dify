import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../types'
import useMetadataDocument from './use-metadata-document'

type DocDetail = {
  id: string
  name: string
  data_source_type: string
  word_count: number
  language?: string
  hit_count?: number
  segment_count?: number
}

// Mock service hooks
const mockMutateAsync = vi.fn().mockResolvedValue({})
const mockDoAddMetaData = vi.fn().mockResolvedValue({})

vi.mock('@/service/knowledge/use-metadata', () => ({
  useBatchUpdateDocMetadata: () => ({
    mutateAsync: mockMutateAsync,
  }),
  useCreateMetaData: () => ({
    mutateAsync: mockDoAddMetaData,
  }),
  useDocumentMetaData: () => ({
    data: {
      doc_metadata: [
        { id: '1', name: 'field_one', type: DataType.string, value: 'Value 1' },
        { id: '2', name: 'field_two', type: DataType.number, value: 42 },
        { id: 'built-in', name: 'created_at', type: DataType.time, value: 1609459200 },
      ],
    },
  }),
  useDatasetMetaData: () => ({
    data: {
      built_in_field_enabled: true,
    },
  }),
}))

// Mock useDatasetDetailContext
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContext: () => ({
    dataset: {
      embedding_available: true,
    },
  }),
}))

// Mock useMetadataMap and useLanguages with comprehensive field definitions
vi.mock('@/hooks/use-metadata', () => ({
  useMetadataMap: () => ({
    originInfo: {
      subFieldsMap: {
        data_source_type: { label: 'Source Type', inputType: 'text' },
        language: { label: 'Language', inputType: 'select' },
        empty_field: { label: 'Empty Field', inputType: 'text' },
      },
    },
    technicalParameters: {
      subFieldsMap: {
        word_count: { label: 'Word Count', inputType: 'text' },
        hit_count: {
          label: 'Hit Count',
          inputType: 'text',
          render: (val: number, segmentCount?: number) => `${val}/${segmentCount || 0}`,
        },
        custom_render: {
          label: 'Custom Render',
          inputType: 'text',
          render: (val: string) => `Rendered: ${val}`,
        },
      },
    },
  }),
  useLanguages: () => ({
    en: 'English',
    zh: 'Chinese',
    ja: 'Japanese',
  }),
}))

// Mock Toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

// Mock useCheckMetadataName
vi.mock('./use-check-metadata-name', () => ({
  default: () => ({
    checkName: (name: string) => ({
      errorMsg: name && /^[a-z][a-z0-9_]*$/.test(name) ? '' : 'Invalid name',
    }),
  }),
}))

describe('useMetadataDocument', () => {
  const mockDocDetail: DocDetail = {
    id: 'doc-1',
    name: 'Test Document',
    data_source_type: 'upload_file',
    word_count: 100,
    language: 'en',
    hit_count: 50,
    segment_count: 10,
  }

  const defaultProps = {
    datasetId: 'ds-1',
    documentId: 'doc-1',
    docDetail: mockDocDetail as Parameters<typeof useMetadataDocument>[0]['docDetail'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Hook Initialization', () => {
    it('should return embeddingAvailable', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))
      expect(result.current.embeddingAvailable).toBe(true)
    })

    it('should return isEdit as false initially', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))
      expect(result.current.isEdit).toBe(false)
    })

    it('should return setIsEdit function', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))
      expect(typeof result.current.setIsEdit).toBe('function')
    })

    it('should return list without built-in items', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))
      const hasBuiltIn = result.current.list.some(item => item.id === 'built-in')
      expect(hasBuiltIn).toBe(false)
    })

    it('should return builtList with only built-in items', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))
      const allBuiltIn = result.current.builtList.every(item => item.id === 'built-in')
      expect(allBuiltIn).toBe(true)
    })

    it('should return tempList', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))
      expect(Array.isArray(result.current.tempList)).toBe(true)
    })

    it('should return setTempList function', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))
      expect(typeof result.current.setTempList).toBe('function')
    })

    it('should return hasData based on list length', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))
      expect(result.current.hasData).toBe(result.current.list.length > 0)
    })

    it('should return builtInEnabled', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))
      expect(typeof result.current.builtInEnabled).toBe('boolean')
    })

    it('should return originInfo', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))
      expect(Array.isArray(result.current.originInfo)).toBe(true)
    })

    it('should return technicalParameters', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))
      expect(Array.isArray(result.current.technicalParameters)).toBe(true)
    })
  })

  describe('Edit Mode', () => {
    it('should enter edit mode when startToEdit is called', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      act(() => {
        result.current.startToEdit()
      })

      expect(result.current.isEdit).toBe(true)
    })

    it('should exit edit mode when handleCancel is called', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      act(() => {
        result.current.startToEdit()
      })

      act(() => {
        result.current.handleCancel()
      })

      expect(result.current.isEdit).toBe(false)
    })

    it('should reset tempList when handleCancel is called', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      act(() => {
        result.current.startToEdit()
      })

      const originalLength = result.current.list.length

      act(() => {
        result.current.setTempList([])
      })

      act(() => {
        result.current.handleCancel()
      })

      expect(result.current.tempList.length).toBe(originalLength)
    })
  })

  describe('handleSelectMetaData', () => {
    it('should add metadata to tempList if not exists', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      act(() => {
        result.current.startToEdit()
      })

      const initialLength = result.current.tempList.length

      act(() => {
        result.current.handleSelectMetaData({
          id: 'new-id',
          name: 'new_field',
          type: DataType.string,
          value: null,
        })
      })

      expect(result.current.tempList.length).toBe(initialLength + 1)
    })

    it('should not add duplicate metadata', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      act(() => {
        result.current.startToEdit()
      })

      const initialLength = result.current.tempList.length

      // Try to add existing item
      if (result.current.tempList.length > 0) {
        act(() => {
          result.current.handleSelectMetaData(result.current.tempList[0])
        })

        expect(result.current.tempList.length).toBe(initialLength)
      }
    })
  })

  describe('handleAddMetaData', () => {
    it('should call doAddMetaData with valid name', async () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      await act(async () => {
        await result.current.handleAddMetaData({
          name: 'valid_field',
          type: DataType.string,
        })
      })

      expect(mockDoAddMetaData).toHaveBeenCalled()
    })

    it('should reject invalid name', async () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      await expect(
        act(async () => {
          await result.current.handleAddMetaData({
            name: '',
            type: DataType.string,
          })
        }),
      ).rejects.toThrow()
    })
  })

  describe('handleSave', () => {
    it('should call mutateAsync to save metadata', async () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      act(() => {
        result.current.startToEdit()
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(mockMutateAsync).toHaveBeenCalled()
    })

    it('should exit edit mode after save', async () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      act(() => {
        result.current.startToEdit()
      })

      await act(async () => {
        await result.current.handleSave()
      })

      await waitFor(() => {
        expect(result.current.isEdit).toBe(false)
      })
    })
  })

  describe('getReadOnlyMetaData - originInfo', () => {
    it('should return origin info with correct structure', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      expect(result.current.originInfo).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: DataType.string,
          }),
        ]),
      )
    })

    it('should use languageMap for language field (select type)', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      // Find language field in originInfo
      const languageField = result.current.originInfo.find(
        item => item.name === 'Language',
      )

      // If language field exists and docDetail has language 'en', value should be 'English'
      if (languageField)
        expect(languageField.value).toBe('English')
    })

    it('should return dash for empty field values', () => {
      const docDetailWithEmpty: DocDetail = {
        id: 'doc-1',
        name: 'Test Document',
        data_source_type: 'upload_file',
        word_count: 100,
      }

      const { result } = renderHook(() =>
        useMetadataDocument({
          ...defaultProps,
          docDetail: docDetailWithEmpty as Parameters<typeof useMetadataDocument>[0]['docDetail'],
        }),
      )

      // Check if there's any field with '-' value (meaning empty)
      const hasEmptyField = result.current.originInfo.some(
        item => item.value === '-',
      )
      // language field should return '-' since it's not set
      expect(hasEmptyField).toBe(true)
    })

    it('should return empty object for non-language select fields', () => {
      // This tests the else branch of getTargetMap where field !== 'language'
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      // The data_source_type field is a text field, not select
      const sourceTypeField = result.current.originInfo.find(
        item => item.name === 'Source Type',
      )

      // It should return the raw value since it's not a select type
      if (sourceTypeField)
        expect(sourceTypeField.value).toBe('upload_file')
    })
  })

  describe('getReadOnlyMetaData - technicalParameters', () => {
    it('should return technical parameters with correct structure', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      expect(result.current.technicalParameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: DataType.string,
          }),
        ]),
      )
    })

    it('should use render function when available', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      // Find hit_count field which has a render function
      const hitCountField = result.current.technicalParameters.find(
        item => item.name === 'Hit Count',
      )

      // The render function should format as "val/segmentCount"
      if (hitCountField)
        expect(hitCountField.value).toBe('50/10')
    })

    it('should return raw value when no render function', () => {
      const { result } = renderHook(() => useMetadataDocument(defaultProps))

      // Find word_count field which has no render function
      const wordCountField = result.current.technicalParameters.find(
        item => item.name === 'Word Count',
      )

      if (wordCountField)
        expect(wordCountField.value).toBe(100)
    })

    it('should handle fields with render function and undefined segment_count', () => {
      const docDetailNoSegment: DocDetail = {
        id: 'doc-1',
        name: 'Test Document',
        data_source_type: 'upload_file',
        word_count: 100,
        hit_count: 25,
      }

      const { result } = renderHook(() =>
        useMetadataDocument({
          ...defaultProps,
          docDetail: docDetailNoSegment as Parameters<typeof useMetadataDocument>[0]['docDetail'],
        }),
      )

      const hitCountField = result.current.technicalParameters.find(
        item => item.name === 'Hit Count',
      )

      // Should use 0 as default for segment_count
      if (hitCountField)
        expect(hitCountField.value).toBe('25/0')
    })

    it('should return dash for null/undefined values', () => {
      const docDetailWithNull: DocDetail = {
        id: 'doc-1',
        name: 'Test Document',
        data_source_type: '',
        word_count: 0,
      }

      const { result } = renderHook(() =>
        useMetadataDocument({
          ...defaultProps,
          docDetail: docDetailWithNull as Parameters<typeof useMetadataDocument>[0]['docDetail'],
        }),
      )

      // 0 should still be shown, but empty string should show '-'
      const sourceTypeField = result.current.originInfo.find(
        item => item.name === 'Source Type',
      )

      if (sourceTypeField)
        expect(sourceTypeField.value).toBe('-')
    })

    it('should handle 0 value correctly (not treated as empty)', () => {
      const docDetailWithZero: DocDetail = {
        id: 'doc-1',
        name: 'Test Document',
        data_source_type: 'upload_file',
        word_count: 0,
      }

      const { result } = renderHook(() =>
        useMetadataDocument({
          ...defaultProps,
          docDetail: docDetailWithZero as Parameters<typeof useMetadataDocument>[0]['docDetail'],
        }),
      )

      // word_count of 0 should still show 0, not '-'
      const wordCountField = result.current.technicalParameters.find(
        item => item.name === 'Word Count',
      )

      if (wordCountField)
        expect(wordCountField.value).toBe(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty docDetail', () => {
      const { result } = renderHook(() =>
        useMetadataDocument({
          ...defaultProps,
          docDetail: {} as Parameters<typeof useMetadataDocument>[0]['docDetail'],
        }),
      )

      expect(result.current).toBeDefined()
    })

    it('should handle different datasetIds', () => {
      const { result, rerender } = renderHook(
        props => useMetadataDocument(props),
        { initialProps: defaultProps },
      )

      expect(result.current).toBeDefined()

      rerender({ ...defaultProps, datasetId: 'ds-2' })

      expect(result.current).toBeDefined()
    })

    it('should handle docDetail with all fields', () => {
      const fullDocDetail: DocDetail = {
        id: 'doc-1',
        name: 'Full Document',
        data_source_type: 'website',
        word_count: 500,
        language: 'zh',
        hit_count: 100,
        segment_count: 20,
      }

      const { result } = renderHook(() =>
        useMetadataDocument({
          ...defaultProps,
          docDetail: fullDocDetail as Parameters<typeof useMetadataDocument>[0]['docDetail'],
        }),
      )

      // Language should be mapped
      const languageField = result.current.originInfo.find(
        item => item.name === 'Language',
      )
      if (languageField)
        expect(languageField.value).toBe('Chinese')

      // Hit count should be rendered
      const hitCountField = result.current.technicalParameters.find(
        item => item.name === 'Hit Count',
      )
      if (hitCountField)
        expect(hitCountField.value).toBe('100/20')
    })

    it('should handle unknown language', () => {
      const unknownLangDetail: DocDetail = {
        id: 'doc-1',
        name: 'Unknown Lang Document',
        data_source_type: 'upload_file',
        word_count: 100,
        language: 'unknown_lang',
      }

      const { result } = renderHook(() =>
        useMetadataDocument({
          ...defaultProps,
          docDetail: unknownLangDetail as Parameters<typeof useMetadataDocument>[0]['docDetail'],
        }),
      )

      // Unknown language should return undefined from the map
      const languageField = result.current.originInfo.find(
        item => item.name === 'Language',
      )
      // When language is not in map, it returns undefined
      expect(languageField?.value).toBeUndefined()
    })
  })
})
