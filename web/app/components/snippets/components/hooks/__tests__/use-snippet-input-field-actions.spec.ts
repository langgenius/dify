import type { SnippetInputField } from '@/models/snippet'
import { act, renderHook } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetDraftStore } from '../../../draft-store'
import { useSnippetInputFieldActions } from '../use-snippet-input-field-actions'

const mockSyncInputFieldsDraft = vi.fn()

vi.mock('../../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    syncInputFieldsDraft: mockSyncInputFieldsDraft,
  }),
}))

const createField = (overrides: Partial<SnippetInputField> = {}): SnippetInputField => ({
  type: PipelineInputVarType.textInput,
  label: 'Blog URL',
  variable: 'blog_url',
  required: true,
  ...overrides,
})

describe('useSnippetInputFieldActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSnippetDraftStore.getState().reset()
    mockSyncInputFieldsDraft.mockResolvedValue(undefined)
  })

  describe('Field sync', () => {
    it('should update fields and sync the draft', () => {
      useSnippetDraftStore.getState().setInputFields([createField()])
      const { result } = renderHook(() => useSnippetInputFieldActions({
        snippetId: 'snippet-1',
      }))
      const nextFields = [
        createField(),
        createField({
          label: 'Topic',
          variable: 'topic',
        }),
      ]

      act(() => {
        result.current.handleFieldsChange(nextFields)
      })

      expect(result.current.fields).toEqual(nextFields)
      expect(useSnippetDraftStore.getState().inputFields).toEqual(nextFields)
      expect(mockSyncInputFieldsDraft).toHaveBeenCalledWith(nextFields, {
        onRefresh: expect.any(Function),
      })
    })
  })
})
