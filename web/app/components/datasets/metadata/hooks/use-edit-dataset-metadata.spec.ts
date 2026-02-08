import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataType } from '../types'
import useEditDatasetMetadata from './use-edit-dataset-metadata'

// Mock service hooks
const mockDoAddMetaData = vi.fn().mockResolvedValue({})
const mockDoRenameMetaData = vi.fn().mockResolvedValue({})
const mockDoDeleteMetaData = vi.fn().mockResolvedValue({})
const mockToggleBuiltInStatus = vi.fn().mockResolvedValue({})

vi.mock('@/service/knowledge/use-metadata', () => ({
  useDatasetMetaData: () => ({
    data: {
      doc_metadata: [
        { id: '1', name: 'field_one', type: DataType.string, count: 5 },
        { id: '2', name: 'field_two', type: DataType.number, count: 3 },
      ],
      built_in_field_enabled: false,
    },
  }),
  useCreateMetaData: () => ({
    mutate: mockDoAddMetaData,
  }),
  useRenameMeta: () => ({
    mutate: mockDoRenameMetaData,
  }),
  useDeleteMetaData: () => ({
    mutateAsync: mockDoDeleteMetaData,
  }),
  useUpdateBuiltInStatus: () => ({
    mutateAsync: mockToggleBuiltInStatus,
  }),
  useBuiltInMetaDataFields: () => ({
    data: {
      fields: [
        { name: 'created_at', type: DataType.time },
        { name: 'modified_at', type: DataType.time },
      ],
    },
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

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('useEditDatasetMetadata', () => {
  const defaultProps = {
    datasetId: 'ds-1',
    onUpdateDocList: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.getItem.mockReturnValue(null)
  })

  describe('Hook Initialization', () => {
    it('should initialize with isShowEditModal as false', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))
      expect(result.current.isShowEditModal).toBe(false)
    })

    it('should return showEditModal function', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))
      expect(typeof result.current.showEditModal).toBe('function')
    })

    it('should return hideEditModal function', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))
      expect(typeof result.current.hideEditModal).toBe('function')
    })

    it('should return datasetMetaData', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))
      expect(result.current.datasetMetaData).toBeDefined()
    })

    it('should return handleAddMetaData function', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))
      expect(typeof result.current.handleAddMetaData).toBe('function')
    })

    it('should return handleRename function', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))
      expect(typeof result.current.handleRename).toBe('function')
    })

    it('should return handleDeleteMetaData function', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))
      expect(typeof result.current.handleDeleteMetaData).toBe('function')
    })

    it('should return builtInMetaData', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))
      expect(result.current.builtInMetaData).toBeDefined()
    })

    it('should return builtInEnabled', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))
      expect(typeof result.current.builtInEnabled).toBe('boolean')
    })

    it('should return setBuiltInEnabled function', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))
      expect(typeof result.current.setBuiltInEnabled).toBe('function')
    })
  })

  describe('Modal Control', () => {
    it('should show modal when showEditModal is called', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))

      act(() => {
        result.current.showEditModal()
      })

      expect(result.current.isShowEditModal).toBe(true)
    })

    it('should hide modal when hideEditModal is called', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))

      act(() => {
        result.current.showEditModal()
      })

      act(() => {
        result.current.hideEditModal()
      })

      expect(result.current.isShowEditModal).toBe(false)
    })

    it('should handle toggle of modal state', () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))

      // Initially closed
      expect(result.current.isShowEditModal).toBe(false)

      // Show, hide, show
      act(() => result.current.showEditModal())
      expect(result.current.isShowEditModal).toBe(true)

      act(() => result.current.hideEditModal())
      expect(result.current.isShowEditModal).toBe(false)

      act(() => result.current.showEditModal())
      expect(result.current.isShowEditModal).toBe(true)
    })
  })

  describe('handleAddMetaData', () => {
    it('should call doAddMetaData with valid name', async () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))

      await act(async () => {
        await result.current.handleAddMetaData({
          name: 'valid_name',
          type: DataType.string,
        })
      })

      expect(mockDoAddMetaData).toHaveBeenCalled()
    })

    it('should reject invalid name', async () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))

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

  describe('handleRename', () => {
    it('should call doRenameMetaData with valid name', async () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))

      await act(async () => {
        await result.current.handleRename({
          id: '1',
          name: 'new_valid_name',
          type: DataType.string,
          count: 5,
        })
      })

      expect(mockDoRenameMetaData).toHaveBeenCalled()
    })

    it('should call onUpdateDocList after rename', async () => {
      const onUpdateDocList = vi.fn()
      const { result } = renderHook(() =>
        useEditDatasetMetadata({ ...defaultProps, onUpdateDocList }),
      )

      await act(async () => {
        await result.current.handleRename({
          id: '1',
          name: 'renamed',
          type: DataType.string,
          count: 5,
        })
      })

      await waitFor(() => {
        expect(onUpdateDocList).toHaveBeenCalled()
      })
    })

    it('should reject invalid name for rename', async () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))

      await expect(
        act(async () => {
          await result.current.handleRename({
            id: '1',
            name: 'Invalid Name',
            type: DataType.string,
            count: 5,
          })
        }),
      ).rejects.toThrow()
    })
  })

  describe('handleDeleteMetaData', () => {
    it('should call doDeleteMetaData', async () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))

      await act(async () => {
        await result.current.handleDeleteMetaData('1')
      })

      expect(mockDoDeleteMetaData).toHaveBeenCalledWith('1')
    })

    it('should call onUpdateDocList after delete', async () => {
      const onUpdateDocList = vi.fn()
      const { result } = renderHook(() =>
        useEditDatasetMetadata({ ...defaultProps, onUpdateDocList }),
      )

      await act(async () => {
        await result.current.handleDeleteMetaData('1')
      })

      await waitFor(() => {
        expect(onUpdateDocList).toHaveBeenCalled()
      })
    })
  })

  describe('Built-in Status', () => {
    it('should toggle built-in status', async () => {
      const { result } = renderHook(() => useEditDatasetMetadata(defaultProps))

      await act(async () => {
        await result.current.setBuiltInEnabled(true)
      })

      expect(mockToggleBuiltInStatus).toHaveBeenCalledWith(true)
    })
  })

  describe('Edge Cases', () => {
    it('should handle different datasetIds', () => {
      const { result, rerender } = renderHook(
        props => useEditDatasetMetadata(props),
        { initialProps: defaultProps },
      )

      expect(result.current).toBeDefined()

      rerender({ ...defaultProps, datasetId: 'ds-2' })

      expect(result.current).toBeDefined()
    })
  })
})
