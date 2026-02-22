import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { act, render, waitFor } from '@testing-library/react'
import {
  $getRoot,
  $nodesOfType,
} from 'lexical'
import { useEffect } from 'react'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { CURRENT_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import {
  CurrentBlock,
  CurrentBlockNode,
  DELETE_CURRENT_BLOCK_COMMAND,
  INSERT_CURRENT_BLOCK_COMMAND,
} from './index'

type CaptureEditorPluginProps = {
  onReady: (editor: LexicalEditor) => void
}

const CaptureEditorPlugin = ({ onReady }: CaptureEditorPluginProps) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    onReady(editor)
  }, [editor, onReady])

  return null
}

const renderCurrentBlock = (props?: {
  generatorType?: GeneratorType
  onInsert?: () => void
  onDelete?: () => void
}) => {
  let editor: LexicalEditor | null = null

  const setEditor = (value: LexicalEditor) => {
    editor = value
  }

  const {
    generatorType = GeneratorType.prompt,
    onInsert,
    onDelete,
  } = props ?? {}

  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'current-block-plugin-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: [CustomTextNode, CurrentBlockNode],
      }}
    >
      <CurrentBlock generatorType={generatorType} onInsert={onInsert} onDelete={onDelete} />
      <CaptureEditorPlugin onReady={setEditor} />
    </LexicalComposer>,
  )

  return {
    ...utils,
    getEditor: () => editor,
  }
}

const selectRoot = (editor: LexicalEditor) => {
  act(() => {
    editor.update(() => {
      $getRoot().selectEnd()
    })
  })
}

const readEditorText = (editor: LexicalEditor) => {
  let content = ''

  editor.getEditorState().read(() => {
    content = $getRoot().getTextContent()
  })

  return content
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

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      selectRoot(editor!)

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(INSERT_CURRENT_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onInsert).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(readEditorText(editor!)).toBe(CURRENT_PLACEHOLDER_TEXT)
      })
      expect(getCurrentNodeCount(editor!)).toBe(1)
      expect(getCurrentNodeGeneratorTypes(editor!)).toEqual([GeneratorType.prompt])
    })

    it('should insert current block without onInsert callback', async () => {
      const { getEditor } = renderCurrentBlock({
        generatorType: GeneratorType.code,
      })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      selectRoot(editor!)

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(INSERT_CURRENT_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      await waitFor(() => {
        expect(readEditorText(editor!)).toBe(CURRENT_PLACEHOLDER_TEXT)
      })
      expect(getCurrentNodeCount(editor!)).toBe(1)
      expect(getCurrentNodeGeneratorTypes(editor!)).toEqual([GeneratorType.code])
    })

    it('should call onDelete when delete command is dispatched', async () => {
      const onDelete = vi.fn()
      const { getEditor } = renderCurrentBlock({ onDelete })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(DELETE_CURRENT_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('should handle delete command without onDelete callback', async () => {
      const { getEditor } = renderCurrentBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      let handled = false
      act(() => {
        handled = editor!.dispatchCommand(DELETE_CURRENT_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
    })
  })

  describe('Lifecycle', () => {
    it('should unregister insert and delete commands when unmounted', async () => {
      const { getEditor, unmount } = renderCurrentBlock()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      unmount()

      let insertHandled = true
      let deleteHandled = true
      act(() => {
        insertHandled = editor!.dispatchCommand(INSERT_CURRENT_BLOCK_COMMAND, undefined)
        deleteHandled = editor!.dispatchCommand(DELETE_CURRENT_BLOCK_COMMAND, undefined)
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
