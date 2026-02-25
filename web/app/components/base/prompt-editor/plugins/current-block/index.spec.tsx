import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import { $nodesOfType } from 'lexical'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { CURRENT_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import {
  getNodeCount,
  readEditorStateValue,
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  waitForEditorReady,
} from '../test-helpers'
import {
  CurrentBlock,
  CurrentBlockNode,
  DELETE_CURRENT_BLOCK_COMMAND,
  INSERT_CURRENT_BLOCK_COMMAND,
} from './index'

const renderCurrentBlock = (props?: {
  generatorType?: GeneratorType
  onInsert?: () => void
  onDelete?: () => void
}) => {
  const {
    generatorType = GeneratorType.prompt,
    onInsert,
    onDelete,
  } = props ?? {}

  return renderLexicalEditor({
    namespace: 'current-block-plugin-test',
    nodes: [CustomTextNode, CurrentBlockNode],
    children: (
      <CurrentBlock generatorType={generatorType} onInsert={onInsert} onDelete={onDelete} />
    ),
  })
}

const getCurrentNodeGeneratorTypes = (editor: LexicalEditor) => {
  return readEditorStateValue(editor, () => {
    return $nodesOfType(CurrentBlockNode).map(node => node.getGeneratorType())
  })
}

describe('CurrentBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Command handling', () => {
    it('should insert current block and call onInsert when insert command is dispatched', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderCurrentBlock({
        generatorType: GeneratorType.prompt,
        onInsert,
      })

      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(INSERT_CURRENT_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onInsert).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(readRootTextContent(editor)).toBe(CURRENT_PLACEHOLDER_TEXT)
      })
      expect(getNodeCount(editor, CurrentBlockNode)).toBe(1)
      expect(getCurrentNodeGeneratorTypes(editor)).toEqual([GeneratorType.prompt])
    })

    it('should insert current block without onInsert callback', async () => {
      const { getEditor } = renderCurrentBlock({
        generatorType: GeneratorType.code,
      })

      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(INSERT_CURRENT_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      await waitFor(() => {
        expect(readRootTextContent(editor)).toBe(CURRENT_PLACEHOLDER_TEXT)
      })
      expect(getNodeCount(editor, CurrentBlockNode)).toBe(1)
      expect(getCurrentNodeGeneratorTypes(editor)).toEqual([GeneratorType.code])
    })

    it('should call onDelete when delete command is dispatched', async () => {
      const onDelete = vi.fn()
      const { getEditor } = renderCurrentBlock({ onDelete })

      const editor = await waitForEditorReady(getEditor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(DELETE_CURRENT_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('should handle delete command without onDelete callback', async () => {
      const { getEditor } = renderCurrentBlock()

      const editor = await waitForEditorReady(getEditor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(DELETE_CURRENT_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
    })
  })

  describe('Lifecycle', () => {
    it('should unregister insert and delete commands when unmounted', async () => {
      const { getEditor, unmount } = renderCurrentBlock()

      const editor = await waitForEditorReady(getEditor)

      unmount()

      let insertHandled = true
      let deleteHandled = true
      act(() => {
        insertHandled = editor.dispatchCommand(INSERT_CURRENT_BLOCK_COMMAND, undefined)
        deleteHandled = editor.dispatchCommand(DELETE_CURRENT_BLOCK_COMMAND, undefined)
      })

      expect(insertHandled).toBe(false)
      expect(deleteHandled).toBe(false)
    })

    it('should throw when current block node is not registered on editor', () => {
      expect(() => {
        render(
          <LexicalComposer
            initialConfig={{
              namespace: 'current-block-plugin-missing-node-test',
              onError: (error: Error) => {
                throw error
              },
              nodes: [CustomTextNode],
            }}
          >
            <CurrentBlock generatorType={GeneratorType.prompt} />
          </LexicalComposer>,
        )
      }).toThrow('CURRENTBlockPlugin: CURRENTBlock not registered on editor')
    })
  })
})
