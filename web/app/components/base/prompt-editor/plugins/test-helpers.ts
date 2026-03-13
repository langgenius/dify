import type {
  Klass,
  LexicalEditor,
  LexicalNode,
} from 'lexical'
import type { ReactNode } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import {
  $createParagraphNode,
  $getRoot,
  $nodesOfType,
  createEditor,
} from 'lexical'
import { createElement } from 'react'
import { expect } from 'vitest'
import { CaptureEditorPlugin } from './test-utils'

type RenderLexicalEditorProps = {
  namespace: string
  nodes?: Array<Klass<LexicalNode>>
  children: ReactNode
}

type RenderLexicalEditorResult = ReturnType<typeof render> & {
  getEditor: () => LexicalEditor | null
}

export const renderLexicalEditor = ({
  namespace,
  nodes = [],
  children,
}: RenderLexicalEditorProps): RenderLexicalEditorResult => {
  let editor: LexicalEditor | null = null

  const utils = render(createElement(
    LexicalComposer,
    {
      initialConfig: {
        namespace,
        onError: (error: Error) => {
          throw error
        },
        nodes,
      },
    },
    children,
    createElement(CaptureEditorPlugin, {
      onReady: (value) => {
        editor = value
      },
    }),
  ))

  return {
    ...utils,
    getEditor: () => editor,
  }
}

export const waitForEditorReady = async (getEditor: () => LexicalEditor | null): Promise<LexicalEditor> => {
  await waitFor(() => {
    if (!getEditor())
      throw new Error('Editor is not ready yet')
  })

  const editor = getEditor()
  if (!editor)
    throw new Error('Editor is not available')

  return editor
}

export const selectRootEnd = (editor: LexicalEditor) => {
  act(() => {
    editor.update(() => {
      $getRoot().selectEnd()
    })
  })
}

export const readRootTextContent = (editor: LexicalEditor): string => {
  let content = ''

  editor.getEditorState().read(() => {
    content = $getRoot().getTextContent()
  })

  return content
}

export const getNodeCount = <T extends LexicalNode>(editor: LexicalEditor, nodeType: Klass<T>): number => {
  let count = 0

  editor.getEditorState().read(() => {
    count = $nodesOfType(nodeType).length
  })

  return count
}

export const getNodesByType = <T extends LexicalNode>(editor: LexicalEditor, nodeType: Klass<T>): T[] => {
  let nodes: T[] = []

  editor.getEditorState().read(() => {
    nodes = $nodesOfType(nodeType)
  })

  return nodes
}

export const readEditorStateValue = <T>(editor: LexicalEditor, reader: () => T): T => {
  let value: T | undefined

  editor.getEditorState().read(() => {
    value = reader()
  })

  if (value === undefined)
    throw new Error('Failed to read editor state value')

  return value
}

export const setEditorRootText = (
  editor: LexicalEditor,
  text: string,
  createTextNode: (text: string) => LexicalNode,
) => {
  act(() => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const paragraph = $createParagraphNode()
      paragraph.append(createTextNode(text))
      root.append(paragraph)
      paragraph.selectEnd()
    })
  })
}

export const createLexicalTestEditor = (namespace: string, nodes: Array<Klass<LexicalNode>>) => {
  return createEditor({
    namespace,
    onError: (error: Error) => {
      throw error
    },
    nodes,
  })
}

export const expectInlineWrapperDom = (dom: HTMLElement, extraClasses: string[] = []) => {
  expect(dom.tagName).toBe('DIV')
  expect(dom).toHaveClass('inline-flex')
  expect(dom).toHaveClass('items-center')
  expect(dom).toHaveClass('align-middle')

  extraClasses.forEach((className) => {
    expect(dom).toHaveClass(className)
  })
}
