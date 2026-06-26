import type { SnippetInputField } from '@/models/snippet'
import { act, renderHook } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetInputFieldActions } from '../use-snippet-input-field-actions'

const mockSyncInputFieldsDraft = vi.fn()
const mockSetFields = vi.fn()

let snippetDetailStoreState: {
  fields: SnippetInputField[]
  setFields: typeof mockSetFields
}

vi.mock('../../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({
    syncInputFieldsDraft: mockSyncInputFieldsDraft,
  }),
}))

vi.mock('../../../store', () => ({
  useSnippetDetailStore: (selector: (state: typeof snippetDetailStoreState) => unknown) => selector(snippetDetailStoreState),
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
    snippetDetailStoreState = {
      fields: [],
      setFields: mockSetFields,
    }
    mockSetFields.mockImplementation((fields: SnippetInputField[]) => {
      snippetDetailStoreState.fields = fields
    })
    mockSyncInputFieldsDraft.mockResolvedValue(undefined)
  })

  describe('Field sync', () => {
    it('should update fields and sync the draft', () => {
      snippetDetailStoreState.fields = [createField()]
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

      expect(result.current.fields).toEqual([createField()])
      expect(mockSetFields).toHaveBeenCalledWith(nextFields)
      expect(mockSyncInputFieldsDraft).toHaveBeenCalledWith(nextFields, {
        onRefresh: expect.any(Function),
      })
    })
  })
})
