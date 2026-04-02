import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, waitFor } from '@testing-library/react'
import { CustomTextNode } from '@/app/components/base/prompt-editor/plugins/custom-text/node'
import {
  getNodeCount,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '@/app/components/base/prompt-editor/plugins/test-helpers'
import { ToolGroupBlockNode } from '../tool-group-block-node'
import ToolGroupBlockReplacementBlock from '../tool-group-block-replacement-block'
import { buildToolTokenList } from '../utils'

vi.mock('../tool-group-block-component', () => ({
  default: ({ tools }: { tools: Array<{ tool: string }> }) => <div>{tools.map(tool => tool.tool).join(',')}</div>,
}))

const tokenList = buildToolTokenList([
  {
    provider: 'openai/tools',
    tool: 'search',
    configId: '11111111-1111-4111-8111-111111111111',
  },
  {
    provider: 'anthropic',
    tool: 'browse',
    configId: '22222222-2222-4222-8222-222222222222',
  },
])

const renderReplacementPlugin = () => {
  return renderLexicalEditor({
    namespace: 'tool-group-block-replacement-plugin-test',
    nodes: [CustomTextNode, ToolGroupBlockNode],
    children: <ToolGroupBlockReplacementBlock />,
  })
}

describe('ToolGroupBlockReplacementBlock', () => {
  it('should replace serialized tool token lists with tool group nodes', async () => {
    const { getEditor } = renderReplacementPlugin()
    const editor = await waitForEditorReady(getEditor)

    setEditorRootText(editor, `prefix ${tokenList} suffix`, text => new CustomTextNode(text))

    await waitFor(() => {
      expect(getNodeCount(editor, ToolGroupBlockNode)).toBe(1)
    })
  })

  it('should leave plain text untouched when no tool token list is present', async () => {
    const { getEditor } = renderReplacementPlugin()
    const editor = await waitForEditorReady(getEditor)

    setEditorRootText(editor, 'plain text without tokens', text => new CustomTextNode(text))

    await waitFor(() => {
      expect(getNodeCount(editor, ToolGroupBlockNode)).toBe(0)
    })
  })

  it('should throw when the tool group block node is not registered', () => {
    expect(() => {
      render(
        <LexicalComposer
          initialConfig={{
            namespace: 'tool-group-block-replacement-plugin-missing-node-test',
            onError: (error: Error) => {
              throw error
            },
            nodes: [CustomTextNode],
          }}
        >
          <ToolGroupBlockReplacementBlock />
        </LexicalComposer>,
      )
    }).toThrow('ToolGroupBlockReplacementBlock: ToolGroupBlockNode not registered on editor')
  })
})
