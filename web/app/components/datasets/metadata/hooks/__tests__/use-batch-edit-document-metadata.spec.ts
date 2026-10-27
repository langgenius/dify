import type { DocumentWithSegmentsResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { MetadataItemWithEdit, MetadataItemWithValue } from '../../types'
import { act } from '@testing-library/react'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { DataType, UpdateType } from '../../types'
import useBatchEditDocumentMetadata from '../use-batch-edit-document-metadata'

const { save } = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.documents.metadata.post': (input) => save(input),
    }),
  }
})
vi.mock('@/app/notifications', () => ({ toast: { success: vi.fn() } }))

const title: MetadataItemWithValue = {
  id: 'title',
  name: 'title',
  type: DataType.string,
  value: 'A',
}
const score: MetadataItemWithValue = {
  id: 'score',
  name: 'score',
  type: DataType.number,
  value: 42,
}
const added: MetadataItemWithValue = { id: 'tag', name: 'tag', type: DataType.string, value: 'new' }
const document = (
  id: string,
  metadata?: MetadataItemWithValue[],
): DocumentWithSegmentsResponse => ({
  id,
  name: id,
  data_source_detail_dict: {},
  doc_metadata: metadata,
})
const docList = [document('doc-1', [title, score]), document('doc-2', [{ ...title, value: 'B' }])]
const setup = (overrides: Partial<Parameters<typeof useBatchEditDocumentMetadata>[0]> = {}) => {
  const onUpdate = vi.fn()
  return {
    onUpdate,
    ...renderHook(() =>
      useBatchEditDocumentMetadata({
        datasetId: 'ds-1',
        docList,
        onUpdate,
        ...overrides,
      }),
    ),
  }
}
beforeEach(() => save.mockReset().mockResolvedValue({ result: 'success' }))

describe('batch metadata editing', () => {
  it('merges shared fields, marks differing values and excludes built-in metadata', () => {
    const { result } = setup({
      docList: [
        ...docList,
        document('doc-3', [title, score, { ...title, id: 'built-in', name: 'created_at' }]),
        document('doc-4'),
      ],
    })
    expect(result.current.originalList).toEqual([
      { ...title, value: null, isMultipleValue: true },
      { ...score, isMultipleValue: false },
    ])
  })

  it('cancels without saving or refreshing documents', () => {
    const { result, onUpdate } = setup()
    act(() => result.current.showEditModal())
    expect(result.current.isShowEditModal).toBe(true)
    act(() => result.current.hideEditModal())
    expect(result.current.isShowEditModal).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('saves edits, removals and additions without editor-only fields', async () => {
    const { result, onUpdate } = setup()
    act(() => result.current.showEditModal())
    const edited: MetadataItemWithEdit = {
      ...title,
      value: 'Updated',
      updateType: UpdateType.changeValue,
      isUpdated: true,
      isMultipleValue: false,
    }
    await act(async () =>
      result.current.handleSave([edited], [{ ...added, isMultipleValue: false }], false),
    )
    expect(save).toHaveBeenCalledWith({
      params: { dataset_id: 'ds-1' },
      body: {
        operation_data: ['doc-1', 'doc-2'].map((document_id) => ({
          document_id,
          partial_update: false,
          metadata_list: [{ ...title, value: 'Updated' }, added],
        })),
      },
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(result.current.isShowEditModal).toBe(false)
  })

  it.each([false, true])(
    'applies missing edited fields only when apply-to-all is %s',
    async (applyToAll) => {
      const { result } = setup()
      await act(async () =>
        result.current.handleSave(
          [
            { ...title, value: null, isMultipleValue: true },
            { ...score, value: 100, updateType: UpdateType.changeValue },
          ],
          [],
          applyToAll,
        ),
      )
      expect(save).toHaveBeenCalledWith({
        params: { dataset_id: 'ds-1' },
        body: {
          operation_data: [
            {
              document_id: 'doc-1',
              partial_update: false,
              metadata_list: [title, { ...score, value: 100 }],
            },
            {
              document_id: 'doc-2',
              partial_update: false,
              metadata_list: [
                { ...title, value: 'B' },
                ...(applyToAll ? [{ ...score, value: 100 }] : []),
              ],
            },
          ],
        },
      })
    },
  )

  it('does not add a field with multiple values to a document missing that field', async () => {
    const { result } = setup({ docList: [...docList, document('doc-3', [])] })
    await act(async () =>
      result.current.handleSave(
        [
          { ...title, value: null, isMultipleValue: true, updateType: UpdateType.changeValue },
          score,
        ],
        [],
        true,
      ),
    )
    expect(save.mock.lastCall?.[0].body.operation_data).toEqual([
      {
        document_id: 'doc-1',
        partial_update: false,
        metadata_list: [{ ...title, value: null }, score],
      },
      { document_id: 'doc-2', partial_update: false, metadata_list: [{ ...title, value: null }] },
      { document_id: 'doc-3', partial_update: false, metadata_list: [] },
    ])
  })

  it('updates only selected documents and preserves unseen metadata through partial updates', async () => {
    const { result } = setup({ selectedDocumentIds: ['doc-2', 'off-page'] })
    await act(async () => result.current.handleSave(result.current.originalList, [added], false))
    expect(save).toHaveBeenCalledWith({
      params: { dataset_id: 'ds-1' },
      body: {
        operation_data: [
          {
            document_id: 'doc-2',
            partial_update: false,
            metadata_list: [{ ...title, value: 'B' }, added],
          },
          { document_id: 'off-page', partial_update: true, metadata_list: [added] },
        ],
      },
    })
  })

  it('keeps the editor open and avoids refreshing after a failed save', async () => {
    const error = new Error('Save failed')
    save.mockRejectedValueOnce(error)
    const { result, onUpdate } = setup()
    act(() => result.current.showEditModal())
    await act(async () => {
      await expect(
        result.current.handleSave(result.current.originalList, [], false),
      ).rejects.toThrow(error)
    })
    expect(result.current.isShowEditModal).toBe(true)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
