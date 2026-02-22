import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { act, render, waitFor } from '@testing-library/react'
import {
  $createParagraphNode,
  $getRoot,
  $nodesOfType,
} from 'lexical'
import { useEffect } from 'react'
import { REQUEST_URL_PLACEHOLDER_TEXT } from '../../constants'
import { CustomTextNode } from '../custom-text/node'
import { RequestURLBlockNode } from './index'
import RequestURLBlockReplacementBlock from './request-url-block-replacement-block'

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

const renderReplacementPlugin = (props?: {
  onInsert?: () => void
}) => {
  let editor: LexicalEditor | null = null

  const setEditor = (value: LexicalEditor) => {
    editor = value
  }

  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'request-url-block-replacement-plugin-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: [CustomTextNode, RequestURLBlockNode],
      }}
    >
      <RequestURLBlockReplacementBlock {...(props ?? {})} />
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

const getRequestURLNodeCount = (editor: LexicalEditor) => {
  let count = 0

  editor.getEditorState().read(() => {
    count = $nodesOfType(RequestURLBlockNode).length
  })

  return count
}

describe('RequestURLBlockReplacementBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Replacement behavior', () => {
    it('should replace placeholder text with request URL block and call onInsert', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({ onInsert })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      setEditorText(editor!, `prefix ${REQUEST_URL_PLACEHOLDER_TEXT} suffix`)

      await waitFor(() => {
        expect(getRequestURLNodeCount(editor!)).toBe(1)
      })
      expect(onInsert).toHaveBeenCalledTimes(1)
    })

    it('should not replace text when placeholder is missing', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderReplacementPlugin({ onInsert })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      setEditorText(editor!, 'plain text without placeholder')

      await waitFor(() => {
        expect(getRequestURLNodeCount(editor!)).toBe(0)
      })
      expect(onInsert).not.toHaveBeenCalled()
    })

    it('should replace placeholder text without onInsert callback', async () => {
      const { getEditor } = renderReplacementPlugin()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      setEditorText(editor!, REQUEST_URL_PLACEHOLDER_TEXT)

      await waitFor(() => {
        expect(getRequestURLNodeCount(editor!)).toBe(1)
      })
    })
  })

  describe('Node registration guard', () => {
    it('should throw when request URL node is not registered on editor', () => {
      expect(() => {
        render(
          <LexicalComposer
            initialConfig={{
              namespace: 'request-url-block-replacement-plugin-missing-node-test',
              onError: (error: Error) => {
                throw error
              },
              nodes: [CustomTextNode],
            }}
          >
            <RequestURLBlockReplacementBlock />
          </LexicalComposer>,
        )
      }).toThrow('RequestURLBlockNodePlugin: RequestURLBlockNode not registered on editor')
    })
  })
})
