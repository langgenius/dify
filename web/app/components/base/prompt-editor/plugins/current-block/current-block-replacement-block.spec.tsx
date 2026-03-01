import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, waitFor } from '@testing-library/react'
import { $nodesOfType } from 'lexical'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { CURRENT_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import {
  getNodeCount,
  readEditorStateValue,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '../test-helpers'
import CurrentBlockReplacementBlock from './current-block-replacement-block'
import { CurrentBlockNode } from './index'

const renderReplacementPlugin = (props?: {
  generatorType?: GeneratorType
  onInsert?: () => void
}) => {
  const {
    generatorType = GeneratorType.prompt,
    onInsert,
  } = props ?? {}

  return renderLexicalEditor({
    namespace: 'current-block-replacement-plugin-test',
    nodes: [CustomTextNode, CurrentBlockNode],
    children: (
      <CurrentBlockReplacementBlock generatorType={generatorType} onInsert={onInsert} />
    ),
  })
}

const getCurrentNodeGeneratorTypes = (editor: LexicalEditor) => {
  return readEditorStateValue(editor, () => {
    return $nodesOfType(CurrentBlockNode).map(node => node.getGeneratorType())
  })
}

describe('CurrentBlockReplacementBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Replacement behavior', () => {
    it('should replace placeholder text and call onInsert when placeholder exists', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({
        generatorType: GeneratorType.prompt,
        onInsert,
      })

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, `prefix ${CURRENT_PLACEHOLDER_TEXT} suffix`, text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodeCount(editor, CurrentBlockNode)).toBe(1)
      })
      expect(getCurrentNodeGeneratorTypes(editor)).toEqual([GeneratorType.prompt])
      expect(onInsert).toHaveBeenCalledTimes(1)
    })

    it('should not replace text when placeholder is missing', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({
        generatorType: GeneratorType.prompt,
        onInsert,
      })

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, 'plain text without current placeholder', text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodeCount(editor, CurrentBlockNode)).toBe(0)
      })
      expect(onInsert).not.toHaveBeenCalled()
    })

    it('should replace placeholder without onInsert callback', async () => {
      const { getEditor } = renderReplacementPlugin({
        generatorType: GeneratorType.code,
      })

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, CURRENT_PLACEHOLDER_TEXT, text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodeCount(editor, CurrentBlockNode)).toBe(1)
      })
      expect(getCurrentNodeGeneratorTypes(editor)).toEqual([GeneratorType.code])
    })
  })

  describe('Node registration guard', () => {
    it('should throw when current block node is not registered on editor', () => {
      expect(() => {
        render(
          <LexicalComposer
            initialConfig={{
              namespace: 'current-block-replacement-plugin-missing-node-test',
              onError: (error: Error) => {
                throw error
              },
              nodes: [CustomTextNode],
            }}
          >
            <CurrentBlockReplacementBlock generatorType={GeneratorType.prompt} />
          </LexicalComposer>,
        )
      }).toThrow('CurrentBlockNodePlugin: CurrentBlockNode not registered on editor')
    })
  })
})
