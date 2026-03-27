import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { act, render, screen, waitFor } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import * as React from 'react'
import FilePickerBlock from '../file-picker-block'

vi.mock('@/app/components/workflow/skill/hooks/file-tree/data/use-skill-asset-tree', () => ({
  useSkillAssetTreeData: () => ({
    data: { children: [] },
    isLoading: false,
    error: null,
  }),
}))

const mockDOMRect = {
  x: 100,
  y: 100,
  width: 100,
  height: 20,
  top: 100,
  right: 200,
  bottom: 120,
  left: 100,
  toJSON: () => ({}),
}

beforeAll(() => {
  Range.prototype.getClientRects = vi.fn(() => {
    const rectList = [mockDOMRect] as unknown as DOMRectList
    Object.defineProperty(rectList, 'length', { value: 1 })
    Object.defineProperty(rectList, 'item', { value: (index: number) => (index === 0 ? mockDOMRect : null) })
    return rectList
  })
  Range.prototype.getBoundingClientRect = vi.fn(() => mockDOMRect as DOMRect)
})

type Captures = {
  editor: LexicalEditor | null
}

const CONTENT_EDITABLE_TEST_ID = 'file-picker-block-ce'

const CaptureEditor = ({ captures }: { captures: Captures }) => {
  const [editor] = useLexicalComposerContext()

  React.useEffect(() => {
    captures.editor = editor
  }, [captures, editor])

  return null
}

const MinimalEditor = ({ captures }: { captures: Captures }) => {
  const initialConfig = React.useMemo(() => ({
    namespace: `file-picker-block-test-${Math.random().toString(16).slice(2)}`,
    onError: (e: Error) => {
      throw e
    },
  }), [])

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <RichTextPlugin
        contentEditable={<ContentEditable data-testid={CONTENT_EDITABLE_TEST_ID} />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <CaptureEditor captures={captures} />
      <FilePickerBlock />
    </LexicalComposer>
  )
}

async function waitForEditor(captures: Captures): Promise<LexicalEditor> {
  await waitFor(() => {
    expect(captures.editor).not.toBeNull()
  })
  return captures.editor as LexicalEditor
}

async function setEditorText(editor: LexicalEditor, text: string): Promise<void> {
  await act(async () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      const textNode = $createTextNode(text)
      paragraph.append(textNode)
      root.append(paragraph)
      textNode.selectEnd()
    })
  })
}

async function flushNextTick(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  })
}

describe('FilePickerBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Regression coverage for the slash-triggered picker lifecycle.
  describe('Typeahead Menu', () => {
    it('should keep the file picker panel rendered when slash opens the menu', async () => {
      const captures: Captures = { editor: null }

      render(<MinimalEditor captures={captures} />)

      const editor = await waitForEditor(captures)

      await setEditorText(editor, '/')

      expect(await screen.findByText('workflow.skillEditor.referenceFiles')).toBeInTheDocument()

      await flushNextTick()

      await waitFor(() => {
        expect(screen.getByText('workflow.skillEditor.referenceFiles')).toBeInTheDocument()
        expect(screen.getByText('workflow.skillSidebar.empty')).toBeInTheDocument()
      })
    })
  })
})
