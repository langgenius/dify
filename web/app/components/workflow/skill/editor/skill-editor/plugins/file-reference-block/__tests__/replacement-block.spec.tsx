import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, waitFor } from '@testing-library/react'
import { CustomTextNode } from '@/app/components/base/prompt-editor/plugins/custom-text/node'
import {
  getNodeCount,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '@/app/components/base/prompt-editor/plugins/test-helpers'
import {
  FileReferenceNode,
} from '../node'
import FileReferenceReplacementBlock from '../replacement-block'
import { buildFileReferenceToken } from '../utils'

vi.mock('../component', () => ({
  default: ({ resourceId }: { resourceId: string }) => <div>{resourceId}</div>,
}))

const resourceId = '11111111-1111-4111-8111-111111111111'

const renderReplacementPlugin = () => {
  return renderLexicalEditor({
    namespace: 'file-reference-replacement-plugin-test',
    nodes: [CustomTextNode, FileReferenceNode],
    children: <FileReferenceReplacementBlock />,
  })
}

describe('FileReferenceReplacementBlock', () => {
  it('should replace serialized file reference tokens with file reference nodes', async () => {
    const { getEditor } = renderReplacementPlugin()
    const editor = await waitForEditorReady(getEditor)

    setEditorRootText(
      editor,
      `prefix ${buildFileReferenceToken(resourceId)} suffix`,
      text => new CustomTextNode(text),
    )

    await waitFor(() => {
      expect(getNodeCount(editor, FileReferenceNode)).toBe(1)
    })
  })

  it('should leave plain text untouched when no token is present', async () => {
    const { getEditor } = renderReplacementPlugin()
    const editor = await waitForEditorReady(getEditor)

    setEditorRootText(editor, 'plain text without tokens', text => new CustomTextNode(text))

    await waitFor(() => {
      expect(getNodeCount(editor, FileReferenceNode)).toBe(0)
    })
  })

  it('should throw when the file reference node is not registered', () => {
    expect(() => {
      render(
        <LexicalComposer
          initialConfig={{
            namespace: 'file-reference-replacement-plugin-missing-node-test',
            onError: (error: Error) => {
              throw error
            },
            nodes: [CustomTextNode],
          }}
        >
          <FileReferenceReplacementBlock />
        </LexicalComposer>,
      )
    }).toThrow('FileReferenceReplacementBlock: FileReferenceNode not registered on editor')
  })
})
