import type { DocumentDetailResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { act, waitFor } from '@testing-library/react'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { DataType } from '../../types'
import useMetadataDocument from '../use-metadata-document'

const fields = [
  { id: '1', name: 'field_one', type: DataType.string, value: 'Value 1' },
  { id: '2', name: 'field_two', type: DataType.number, value: 42 },
]
const builtin = { id: 'built-in', name: 'created_at', type: DataType.time, value: 1609459200 }
const mockSave = vi.fn().mockResolvedValue({ result: 'success' })
const mockCreate = vi.fn().mockResolvedValue({ id: 'new-field', name: 'new_field', type: 'string' })
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.metadata.post': (input) => mockSave(input),
      'datasets.byDatasetId.metadata.post': (input) => mockCreate(input),
      'datasets.byDatasetId.documents.byDocumentId.get': async () => ({
        id: 'doc-1',
        doc_metadata: [...fields, builtin],
      }),
      'datasets.byDatasetId.metadata.get': async () => ({
        built_in_field_enabled: true,
        doc_metadata: [],
      }),
    }),
  }
})
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContext: () => ({ dataset: { embedding_available: true } }),
}))
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const docDetail: DocumentDetailResponse = {
  id: 'doc-1',
  name: 'Guide',
  data_source_type: 'upload_file',
  hit_count: 5,
  segment_count: 10,
}
const props = { datasetId: 'ds-1', documentId: 'doc-1', docDetail }
async function setup() {
  const hook = renderHook(() => useMetadataDocument(props))
  await waitFor(() => expect(hook.result.current.list).toEqual(fields))
  return hook
}

it('separates loaded builtin and editable metadata', async () => {
  const { result } = await setup()
  expect(result.current.builtList).toEqual([builtin])
  expect(result.current.hasData).toBe(true)
  await waitFor(() => expect(result.current.builtInEnabled).toBe(true))
})

it('deduplicates selected metadata and saves the edited list to the selected document', async () => {
  const { result } = await setup()
  act(() => result.current.startToEdit())
  const added = { id: '3', name: 'new_field', type: DataType.string, value: 'Added' }
  act(() => result.current.handleSelectMetaData(added))
  act(() => result.current.handleSelectMetaData(added))
  await act(async () => result.current.handleSave())
  expect(mockSave).toHaveBeenCalledExactlyOnceWith({
    params: { dataset_id: 'ds-1' },
    body: { operation_data: [{ document_id: 'doc-1', metadata_list: [...fields, added] }] },
  })
  expect(result.current.isEdit).toBe(false)
})

it('discards changes when canceled and restores loaded values on reopening', async () => {
  const { result } = await setup()
  act(() => result.current.startToEdit())
  act(() => result.current.setTempList([]))
  act(() => result.current.handleCancel())
  expect(result.current.isEdit).toBe(false)
  act(() => result.current.startToEdit())
  expect(result.current.tempList).toEqual(fields)
  expect(mockSave).not.toHaveBeenCalled()
})

it('keeps the edit draft after a failed save', async () => {
  mockSave.mockRejectedValueOnce(new Error('offline'))
  const { result } = await setup()
  act(() => result.current.startToEdit())
  act(() => result.current.setTempList([fields[1]!]))
  await act(async () => {
    await expect(result.current.handleSave()).rejects.toThrow('offline')
  })
  expect(result.current.isEdit).toBe(true)
  expect(result.current.tempList).toEqual([fields[1]])
})

it('validates metadata names before creating a field in the selected dataset', async () => {
  const { result } = await setup()
  await act(async () => {
    await expect(
      result.current.handleAddMetaData({ name: '', type: DataType.string }),
    ).rejects.toThrow()
  })
  expect(mockCreate).not.toHaveBeenCalled()
  await act(async () =>
    result.current.handleAddMetaData({ name: 'new_field', type: DataType.string }),
  )
  expect(mockCreate).toHaveBeenCalledExactlyOnceWith({
    params: { dataset_id: 'ds-1' },
    body: { name: 'new_field', type: DataType.string },
  })
})

it('formats actual readonly fields, including hit counts, zero values, and missing values', () => {
  const { result } = renderHook(() =>
    useMetadataDocument({ ...props, docDetail: { ...docDetail, average_segment_length: 0 } }),
  )
  expect(result.current.originInfo).toContainEqual(
    expect.objectContaining({
      name: 'datasetDocuments.metadata.field.originInfo.originalFilename',
      value: 'Guide',
    }),
  )
  expect(result.current.originInfo).toContainEqual(
    expect.objectContaining({
      name: 'datasetDocuments.metadata.field.originInfo.originalFileSize',
      value: '-',
    }),
  )
  expect(result.current.technicalParameters).toContainEqual(
    expect.objectContaining({
      name: 'datasetDocuments.metadata.field.technicalParameters.hitCount',
      value: '50.00% (5/10)',
    }),
  )
  expect(result.current.technicalParameters).toContainEqual(
    expect.objectContaining({
      name: 'datasetDocuments.metadata.field.technicalParameters.avgParagraphLength',
      value: '0 characters',
    }),
  )
})
