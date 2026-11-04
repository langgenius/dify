import { $createParagraphNode, $getRoot, $nodesOfType } from 'lexical'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { createLexicalTestEditor } from '../../__tests__/test-helpers'
import { $createCurrentBlockNode, CurrentBlockNode } from '../node'

it('preserves current-prompt and current-code tokens through an editor save and restore', () => {
  const editor = createLexicalTestEditor('current-save', [CurrentBlockNode])
  editor.update(
    () => {
      const paragraph = $createParagraphNode()
      paragraph.append(
        $createCurrentBlockNode(GeneratorType.prompt),
        $createCurrentBlockNode(GeneratorType.code),
      )
      $getRoot().append(paragraph)
    },
    { discrete: true },
  )
  const restored = createLexicalTestEditor('current-restore', [CurrentBlockNode])
  restored.setEditorState(restored.parseEditorState(JSON.stringify(editor.getEditorState())))
  restored.getEditorState().read(() => {
    expect($getRoot().getTextContent()).toBe('{{#current#}}{{#current#}}')
    expect($nodesOfType(CurrentBlockNode).map((node) => node.getGeneratorType())).toEqual([
      GeneratorType.prompt,
      GeneratorType.code,
    ])
  })
})
