import type { SnippetInputField } from '@/models/snippet'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetDraftStore } from '..'

const createField = (variable: string): SnippetInputField => ({
  label: variable,
  variable,
  type: PipelineInputVarType.textInput,
  required: true,
})

describe('useSnippetDraftStore', () => {
  beforeEach(() => {
    useSnippetDraftStore.getState().reset()
  })

  it('should store and reset snippet input fields', () => {
    const inputFields = [createField('topic'), createField('audience')]

    useSnippetDraftStore.getState().hydrateDraft({
      snippetId: 'snippet-1',
      inputFields,
    })

    expect(useSnippetDraftStore.getState().snippetId).toBe('snippet-1')
    expect(useSnippetDraftStore.getState().inputFields).toEqual(inputFields)

    useSnippetDraftStore.getState().reset()

    expect(useSnippetDraftStore.getState().snippetId).toBeUndefined()
    expect(useSnippetDraftStore.getState().inputFields).toEqual([])
  })
})
