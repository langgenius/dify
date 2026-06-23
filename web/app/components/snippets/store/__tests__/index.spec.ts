import type { SnippetDetail } from '@/models/snippet'
import { useSnippetDetailStore } from '..'

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
      readonly: true,
      snippet: undefined,
      snippetId: undefined,
      onFieldsChange: undefined,
    })
  })
})
