import type { SnippetDetail, SnippetInputField } from '@/models/snippet'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetDetailStore } from '..'

const createField = (variable: string): SnippetInputField => ({
  label: variable,
  variable,
  type: PipelineInputVarType.textInput,
  required: true,
})

const snippet: SnippetDetail = {
  id: 'snippet-1',
  name: 'Snippet',
  description: 'Description',
  updatedAt: '2026-03-29 10:00',
  usage: '0',
  tags: [],
}

describe('useSnippetDetailStore', () => {
  beforeEach(() => {
    useSnippetDetailStore.getState().reset()
  })

  it('should store and reset snippet input fields', () => {
    const fields = [
      createField('topic'),
      createField('audience'),
    ]

    useSnippetDetailStore.getState().setFields(fields)

    expect(useSnippetDetailStore.getState().fields).toEqual(fields)

    useSnippetDetailStore.getState().reset()

    expect(useSnippetDetailStore.getState().fields).toEqual([])
  })

  it('should store and reset snippet navigation state', () => {
    const onFieldsChange = vi.fn()

    useSnippetDetailStore.getState().setNavigationState({
      snippetId: 'snippet-1',
      snippet,
      readonly: false,
      onFieldsChange,
    })

    expect(useSnippetDetailStore.getState()).toMatchObject({
      snippetId: 'snippet-1',
      snippet,
      readonly: false,
      onFieldsChange,
    })

    useSnippetDetailStore.getState().reset()

    expect(useSnippetDetailStore.getState()).toMatchObject({
      fields: [],
      readonly: true,
      snippet: undefined,
      snippetId: undefined,
      onFieldsChange: undefined,
    })
  })
})
