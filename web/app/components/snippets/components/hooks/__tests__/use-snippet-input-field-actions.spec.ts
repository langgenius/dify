import type { SnippetInputField } from '@/models/snippet'
import { act, renderHook } from '@testing-library/react'
import { toast } from '@langgenius/dify-ui/toast'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetInputFieldActions } from '../use-snippet-input-field-actions'

const mockSyncInputFieldsDraft = vi.fn()
const mockCloseEditor = vi.fn()
const mockOpenEditor = vi.fn()
const mockSetFields = vi.fn()
const mockSetInputPanelOpen = vi.fn()
const mockToggleInputPanel = vi.fn()

let snippetDetailStoreState: {
  editingField: SnippetInputField | null
  fields: SnippetInputField[]
  isEditorOpen: boolean
  isInputPanelOpen: boolean
  closeEditor: typeof mockCloseEditor
  openEditor: typeof mockOpenEditor
  setFields: typeof mockSetFields
  setInputPanelOpen: typeof mockSetInputPanelOpen
  toggleInputPanel: typeof mockToggleInputPanel
}

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

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
      editingField: null,
      fields: [],
      isEditorOpen: false,
      isInputPanelOpen: true,
      closeEditor: mockCloseEditor,
      openEditor: mockOpenEditor,
      setFields: mockSetFields,
      setInputPanelOpen: mockSetInputPanelOpen,
      toggleInputPanel: mockToggleInputPanel,
    }
    mockSetFields.mockImplementation((fields: SnippetInputField[]) => {
      snippetDetailStoreState.fields = fields
    })
    mockSyncInputFieldsDraft.mockResolvedValue(undefined)
  })

  describe('Field sync', () => {
    it('should remove a field and sync the draft', () => {
      snippetDetailStoreState.fields = [createField()]
      const { result } = renderHook(() => useSnippetInputFieldActions({
        snippetId: 'snippet-1',
      }))

      act(() => {
        result.current.handleRemoveField(0)
      })

      expect(mockSetFields).toHaveBeenCalledWith([])
      expect(mockSyncInputFieldsDraft).toHaveBeenCalledWith([], {
        onRefresh: expect.any(Function),
      })
    })

    it('should append a new field and close the editor after syncing', () => {
      snippetDetailStoreState.fields = [createField()]
      const { result } = renderHook(() => useSnippetInputFieldActions({
        snippetId: 'snippet-1',
      }))

      act(() => {
        result.current.handleSubmitField(createField({
          label: 'Topic',
          variable: 'topic',
        }))
      })

      expect(mockSetFields).toHaveBeenCalledWith([
        createField(),
        createField({
          label: 'Topic',
          variable: 'topic',
        }),
      ])
      expect(mockSyncInputFieldsDraft).toHaveBeenCalledWith([
        createField(),
        createField({
          label: 'Topic',
          variable: 'topic',
        }),
      ], {
        onRefresh: expect.any(Function),
      })
      expect(mockCloseEditor).toHaveBeenCalledTimes(1)
    })

    it('should reject duplicated variables without syncing', () => {
      snippetDetailStoreState.fields = [createField()]
      const { result } = renderHook(() => useSnippetInputFieldActions({
        snippetId: 'snippet-1',
      }))

      act(() => {
        result.current.handleSubmitField(createField({
          label: 'Duplicated',
          variable: 'blog_url',
        }))
      })

      expect(toast.error).toHaveBeenCalledWith('datasetPipeline.inputFieldPanel.error.variableDuplicate')
      expect(mockSyncInputFieldsDraft).not.toHaveBeenCalled()
      expect(mockCloseEditor).not.toHaveBeenCalled()
      expect(mockSetFields).not.toHaveBeenCalled()
    })
  })

  describe('Panel actions', () => {
    it('should close the editor before toggling the input panel when the panel is open', () => {
      snippetDetailStoreState.fields = [createField()]
      const { result } = renderHook(() => useSnippetInputFieldActions({
        snippetId: 'snippet-1',
      }))

      act(() => {
        result.current.handleToggleInputPanel()
      })

      expect(mockCloseEditor).toHaveBeenCalledTimes(1)
      expect(mockToggleInputPanel).toHaveBeenCalledTimes(1)
    })

    it('should close the input panel and clear the editor state', () => {
      snippetDetailStoreState.fields = [createField()]
      const { result } = renderHook(() => useSnippetInputFieldActions({
        snippetId: 'snippet-1',
      }))

      act(() => {
        result.current.handleCloseInputPanel()
      })

      expect(mockCloseEditor).toHaveBeenCalledTimes(1)
      expect(mockSetInputPanelOpen).toHaveBeenCalledWith(false)
    })
  })
})
