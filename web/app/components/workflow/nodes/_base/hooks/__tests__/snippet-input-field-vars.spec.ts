import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { appendSnippetInputFieldVars } from '../snippet-input-field-vars'

const createNode = (id = 'node-1'): Node =>
  ({
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: BlockEnum.LLM,
      title: 'Node',
      desc: '',
    },
  }) as Node

describe('appendSnippetInputFieldVars', () => {
  beforeEach(() => {
    globalThis.history.pushState({}, '', '/')
  })

  it('should treat missing snippet input fields as empty on snippet canvases', () => {
    globalThis.history.pushState({}, '', '/snippets/snippet-1/orchestrate')
    const availableNodes = [createNode()]

    expect(
      appendSnippetInputFieldVars({
        availableNodes,
        fields: undefined,
        title: 'Snippet',
      }),
    ).toEqual({
      availableNodes,
      availableVars: [],
    })
  })
})
