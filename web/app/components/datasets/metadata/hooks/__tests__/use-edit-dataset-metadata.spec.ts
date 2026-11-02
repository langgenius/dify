import { act, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { DataType, isShowManageMetadataLocalStorageKey } from '../../types'
import useEditDatasetMetadata from '../use-edit-dataset-metadata'

const mockDoAddMetaData = vi.fn().mockResolvedValue({})
const mockDoRenameMetaData = vi.fn().mockResolvedValue({})
const mockDoDeleteMetaData = vi.fn().mockResolvedValue({})
const mockToggleBuiltInStatus = vi.fn().mockResolvedValue({})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.metadata.get': async () => ({
        doc_metadata: [
          { id: '1', name: 'field_one', type: DataType.string, count: 5 },
          { id: '2', name: 'field_two', type: DataType.number, count: 3 },
        ],
        built_in_field_enabled: false,
      }),
      'datasets.byDatasetId.metadata.post': (input) => mockDoAddMetaData(input),
      'datasets.byDatasetId.metadata.byMetadataId.patch': (input) => mockDoRenameMetaData(input),
      'datasets.byDatasetId.metadata.byMetadataId.delete': (input) => mockDoDeleteMetaData(input),
      'datasets.byDatasetId.metadata.builtIn.byAction.post': (input) =>
        mockToggleBuiltInStatus(input),
      'datasets.metadata.builtIn.get': async () => ({
        fields: [
          { name: 'created_at', type: DataType.time },
          { name: 'modified_at', type: DataType.time },
        ],
      }),
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  default: {
    notify: vi.fn(),
  },
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

beforeEach(() => localStorage.removeItem(isShowManageMetadataLocalStorageKey))
afterEach(() => localStorage.removeItem(isShowManageMetadataLocalStorageKey))

it('consumes the management navigation flag once and opens the editor', () => {
  localStorage.setItem(isShowManageMetadataLocalStorageKey, 'true')
  const { result, unmount } = renderHook(() =>
    useEditDatasetMetadata({ datasetId: 'ds-1', onUpdateDocList: vi.fn() }),
  )
  expect(result.current.isShowEditModal).toBe(true)
  expect(localStorage.getItem(isShowManageMetadataLocalStorageKey)).toBeNull()
  unmount()
  const next = renderHook(() =>
    useEditDatasetMetadata({ datasetId: 'ds-1', onUpdateDocList: vi.fn() }),
  )
  expect(next.result.current.isShowEditModal).toBe(false)
})

it('sends dataset metadata mutations with their resource identity and refreshes affected documents', async () => {
  const onUpdateDocList = vi.fn()
  const { result } = renderHook(() =>
    useEditDatasetMetadata({ datasetId: 'ds-1', onUpdateDocList }),
  )
  await act(async () =>
    result.current.handleAddMetaData({ name: 'category', type: DataType.string }),
  )
  expect(mockDoAddMetaData).toHaveBeenCalledWith({
    params: { dataset_id: 'ds-1' },
    body: { name: 'category', type: DataType.string },
  })
  await act(async () =>
    result.current.handleRename({ id: '1', name: 'renamed', type: DataType.string, count: 5 }),
  )
  expect(mockDoRenameMetaData).toHaveBeenCalledWith({
    params: { dataset_id: 'ds-1', metadata_id: '1' },
    body: { name: 'renamed' },
  })
  expect(onUpdateDocList).toHaveBeenCalledOnce()
  await act(async () => result.current.handleDeleteMetaData('1'))
  expect(mockDoDeleteMetaData).toHaveBeenCalledWith({
    params: { dataset_id: 'ds-1', metadata_id: '1' },
  })
  expect(onUpdateDocList).toHaveBeenCalledTimes(2)
})

it('rejects invalid names before creating or renaming metadata', async () => {
  const { result } = renderHook(() =>
    useEditDatasetMetadata({ datasetId: 'ds-1', onUpdateDocList: vi.fn() }),
  )
  await expect(
    result.current.handleAddMetaData({ name: '', type: DataType.string }),
  ).rejects.toThrow()
  await expect(
    result.current.handleRename({ id: '1', name: 'Invalid Name', type: DataType.string, count: 5 }),
  ).rejects.toThrow()
  expect(mockDoAddMetaData).not.toHaveBeenCalled()
  expect(mockDoRenameMetaData).not.toHaveBeenCalled()
})

it('updates built-in metadata after the server accepts the requested status', async () => {
  const { result } = renderHook(() =>
    useEditDatasetMetadata({ datasetId: 'ds-1', onUpdateDocList: vi.fn() }),
  )
  await waitFor(() => expect(result.current.builtInEnabled).toBe(false))
  await act(async () => result.current.setBuiltInEnabled(true))
  expect(mockToggleBuiltInStatus).toHaveBeenCalledWith({
    params: { dataset_id: 'ds-1', action: 'enable' },
  })
  expect(result.current.builtInEnabled).toBe(true)
  await act(async () => result.current.setBuiltInEnabled(false))
  expect(mockToggleBuiltInStatus).toHaveBeenLastCalledWith({
    params: { dataset_id: 'ds-1', action: 'disable' },
  })
  expect(result.current.builtInEnabled).toBe(false)
})
