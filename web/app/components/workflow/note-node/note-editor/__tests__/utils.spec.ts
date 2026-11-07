import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical'
import { getSelectedNode, urlRegExp } from '../utils'

describe('note editor utils', () => {
  it('selects the shared text node for a range within it', () => {
    const editor = createEditor({
      onError: (error) => {
        throw error
      },
    })
    editor.update(
      () => {
        const node = $createTextNode('Example')
        $getRoot().append($createParagraphNode().append(node))
        const selection = $createRangeSelection()
        selection.anchor.set(node.getKey(), 1, 'text')
        selection.focus.set(node.getKey(), 4, 'text')
        expect(getSelectedNode(selection)).toBe(node)
      },
      { discrete: true },
    )
  })

  it('selects the focus node for a backward range ending within an earlier node', () => {
    const editor = createEditor({
      onError: (error) => {
        throw error
      },
    })
    editor.update(
      () => {
        const first = $createTextNode('First')
        const second = $createTextNode('Second')
        $getRoot().append(
          $createParagraphNode().append(first),
          $createParagraphNode().append(second),
        )
        const selection = $createRangeSelection()
        selection.anchor.set(second.getKey(), 3, 'text')
        selection.focus.set(first.getKey(), 2, 'text')
        expect(getSelectedNode(selection)).toBe(first)
      },
      { discrete: true },
    )
  })

  it('recognizes a document URL', () => {
    expect(urlRegExp.test('https://dify.ai/docs')).toBe(true)
  })
})
