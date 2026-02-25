import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import {
  $createParagraphNode,
  $getRoot,
  $nodesOfType,
} from 'lexical'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { CURRENT_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import { CaptureEditorPlugin } from '../test-utils'
import CurrentBlockReplacementBlock from './current-block-replacement-block'
import { CurrentBlockNode } from './index'

const renderReplacementPlugin = (props?: {
  generatorType?: GeneratorType
  onInsert?: () => void
}) => {
  let editor: LexicalEditor | null = null

  const setEditor = (value: LexicalEditor) => {
    editor = value
  }

  const {
    generatorType = GeneratorType.prompt,
    onInsert,
  } = props ?? {}

  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'current-block-replacement-plugin-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: [CustomTextNode, CurrentBlockNode],
      }}
    >
      <CurrentBlockReplacementBlock generatorType={generatorType} onInsert={onInsert} />
      <CaptureEditorPlugin onReady={setEditor} />
    </LexicalComposer>,
  )

  return {
    ...utils,
    getEditor: () => editor,
  }
}

const setEditorText = (editor: LexicalEditor, text: string) => {
  act(() => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const paragraph = $createParagraphNode()
      paragraph.append(new CustomTextNode(text))
      root.append(paragraph)
      paragraph.selectEnd()
    })
  })
}

const getCurrentNodeCount = (editor: LexicalEditor) => {
  let count = 0

  editor.getEditorState().read(() => {
    count = $nodesOfType(CurrentBlockNode).length
  })

  return count
}

const getCurrentNodeGeneratorTypes = (editor: LexicalEditor) => {
  let generatorTypes: GeneratorType[] = []

  editor.getEditorState().read(() => {
    generatorTypes = $nodesOfType(CurrentBlockNode).map(node => node.getGeneratorType())
  })

  return generatorTypes
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

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      setEditorText(editor!, `prefix ${CURRENT_PLACEHOLDER_TEXT} suffix`)

      await waitFor(() => {
        expect(getCurrentNodeCount(editor!)).toBe(1)
      })
      expect(getCurrentNodeGeneratorTypes(editor!)).toEqual([GeneratorType.prompt])
      expect(onInsert).toHaveBeenCalledTimes(1)
    })

    it('should not replace text when placeholder is missing', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({
        generatorType: GeneratorType.prompt,
        onInsert,
      })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      setEditorText(editor!, 'plain text without current placeholder')

      await waitFor(() => {
        expect(getCurrentNodeCount(editor!)).toBe(0)
      })
      expect(onInsert).not.toHaveBeenCalled()
    })

    it('should replace placeholder without onInsert callback', async () => {
      const { getEditor } = renderReplacementPlugin({
        generatorType: GeneratorType.code,
      })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      setEditorText(editor!, CURRENT_PLACEHOLDER_TEXT)

      await waitFor(() => {
        expect(getCurrentNodeCount(editor!)).toBe(1)
      })
      expect(getCurrentNodeGeneratorTypes(editor!)).toEqual([GeneratorType.code])
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
