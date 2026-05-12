import type { SnippetInputField } from '@/models/snippet'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetDetailStore } from '..'

const createField = (variable: string): SnippetInputField => ({
  label: variable,
  variable,
  type: PipelineInputVarType.textInput,
  required: true,
})

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
})
