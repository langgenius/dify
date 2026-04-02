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
  ToolBlockNode,
} from '../node'
import ToolBlockReplacementBlock from '../tool-block-replacement-block'
import { buildToolToken } from '../utils'

vi.mock('../component', () => ({
  default: ({ tool }: { tool: string }) => <div>{tool}</div>,
}))

const token = buildToolToken({
  provider: 'openai/tools',
  tool: 'search',
  configId: '11111111-1111-4111-8111-111111111111',
})

const renderReplacementPlugin = () => {
  return renderLexicalEditor({
    namespace: 'tool-block-replacement-plugin-test',
    nodes: [CustomTextNode, ToolBlockNode],
    children: <ToolBlockReplacementBlock />,
  })
}

describe('ToolBlockReplacementBlock', () => {
  it('should replace serialized tool tokens with tool block nodes', async () => {
    const { getEditor } = renderReplacementPlugin()
    const editor = await waitForEditorReady(getEditor)

    setEditorRootText(editor, `prefix ${token} suffix`, text => new CustomTextNode(text))

    await waitFor(() => {
      expect(getNodeCount(editor, ToolBlockNode)).toBe(1)
    })
  })

  it('should leave plain text untouched when no token is present', async () => {
    const { getEditor } = renderReplacementPlugin()
    const editor = await waitForEditorReady(getEditor)

    setEditorRootText(editor, 'plain text without tokens', text => new CustomTextNode(text))

    await waitFor(() => {
      expect(getNodeCount(editor, ToolBlockNode)).toBe(0)
    })
  })

  it('should throw when the tool block node is not registered', () => {
    expect(() => {
      render(
        <LexicalComposer
          initialConfig={{
            namespace: 'tool-block-replacement-plugin-missing-node-test',
            onError: (error: Error) => {
              throw error
            },
            nodes: [CustomTextNode],
          }}
        >
          <ToolBlockReplacementBlock />
        </LexicalComposer>,
      )
    }).toThrow('ToolBlockReplacementBlock: ToolBlockNode not registered on editor')
  })
})
