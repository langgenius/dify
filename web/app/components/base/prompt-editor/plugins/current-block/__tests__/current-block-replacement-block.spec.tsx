import type { LexicalEditor } from 'lexical'
import { waitFor } from '@testing-library/react'
import { $getRoot, $nodesOfType } from 'lexical'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { CURRENT_PLACEHOLDER_TEXT } from '../../../constants'
import {
  getNodeCount,
  readEditorStateValue,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '../../__tests__/test-helpers'
import { CustomTextNode } from '../../custom-text/node'
import CurrentBlockReplacementBlock from '../current-block-replacement-block'
import { CurrentBlockNode } from '../index'

const renderReplacementPlugin = (props?: {
  generatorType?: GeneratorType
  onInsert?: () => void
}) => {
  const { generatorType = GeneratorType.prompt, onInsert } = props ?? {}

  return renderLexicalEditor({
    namespace: 'current-block-replacement-plugin-test',
    nodes: [CustomTextNode, CurrentBlockNode],
    children: <CurrentBlockReplacementBlock generatorType={generatorType} onInsert={onInsert} />,
  })
}

const getCurrentNodeGeneratorTypes = (editor: LexicalEditor) => {
  return readEditorStateValue(editor, () => {
    return $nodesOfType(CurrentBlockNode).map((node) => node.getGeneratorType())
  })
}

describe('CurrentBlockReplacementBlock', () => {
  describe('Replacement behavior', () => {
    it.each([GeneratorType.prompt, GeneratorType.code])(
      'replaces the placeholder for %s while preserving surrounding text',
      async (generatorType) => {
        const onInsert = vi.fn()
        const { getEditor } = renderReplacementPlugin({
          generatorType,
          onInsert,
        })

        const editor = await waitForEditorReady(getEditor)

        setEditorRootText(
          editor,
          `prefix ${CURRENT_PLACEHOLDER_TEXT} suffix`,
          (text) => new CustomTextNode(text),
        )

        await waitFor(() => {
          expect(getNodeCount(editor, CurrentBlockNode)).toBe(1)
        })
        expect(getCurrentNodeGeneratorTypes(editor)).toEqual([generatorType])
        expect(readEditorStateValue(editor, () => $getRoot().getTextContent())).toBe(
          `prefix ${CURRENT_PLACEHOLDER_TEXT} suffix`,
        )
        expect(onInsert).toHaveBeenCalledTimes(1)
      },
    )

    it('should not replace text when placeholder is missing', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({
        generatorType: GeneratorType.prompt,
        onInsert,
      })

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(
        editor,
        'plain text without current placeholder',
        (text) => new CustomTextNode(text),
      )

      await waitFor(() => {
        expect(getNodeCount(editor, CurrentBlockNode)).toBe(0)
      })
      expect(onInsert).not.toHaveBeenCalled()
    })
  })
})
