import { act, render, screen } from '@testing-library/react'
import {
  createLexicalTestEditor,
} from '@/app/components/base/prompt-editor/plugins/test-helpers'
import {
  $createToolGroupBlockNode,
  $isToolGroupBlockNode,
  ToolGroupBlockNode,
} from '../tool-group-block-node'
import { buildToolTokenList } from '../utils'

vi.mock('../tool-group-block-component', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="tool-group-block-component">{JSON.stringify(props)}</div>
  ),
}))

const tools = [
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
]

describe('ToolGroupBlockNode', () => {
  it('should expose lexical metadata and serialize its payload', () => {
    const editor = createLexicalTestEditor('tool-group-block-node-metadata-test', [ToolGroupBlockNode])
    let node!: ToolGroupBlockNode

    act(() => {
      editor.update(() => {
        node = $createToolGroupBlockNode({ tools })
      })
    })

    const dom = node.createDOM()

    expect(ToolGroupBlockNode.getType()).toBe('tool-group-block')
    expect(node.isInline()).toBe(true)
    expect(node.updateDOM()).toBe(false)
    expect(node.exportJSON()).toEqual({
      type: 'tool-group-block',
      version: 1,
      tools,
    })
    expect(node.getTextContent()).toBe(buildToolTokenList(tools))
    expect($isToolGroupBlockNode(node)).toBe(true)
    expect($isToolGroupBlockNode(null)).toBe(false)
    expect(dom.tagName).toBe('SPAN')
    expect(dom).toHaveClass('inline-flex', 'items-center', 'align-middle')
  })

  it('should clone and import serialized nodes', () => {
    const editor = createLexicalTestEditor('tool-group-block-node-clone-test', [ToolGroupBlockNode])
    let original!: ToolGroupBlockNode
    let cloned!: ToolGroupBlockNode
    let imported!: ToolGroupBlockNode

    act(() => {
      editor.update(() => {
        original = $createToolGroupBlockNode({ tools })
        cloned = ToolGroupBlockNode.clone(original)
        imported = ToolGroupBlockNode.importJSON({
          type: 'tool-group-block',
          version: 1,
          tools: tools.slice(0, 1),
        })
      })
    })

    expect(cloned).not.toBe(original)
    expect(cloned.exportJSON()).toEqual(original.exportJSON())
    expect(imported.exportJSON()).toEqual({
      type: 'tool-group-block',
      version: 1,
      tools: tools.slice(0, 1),
    })
  })

  it('should decorate the node with the tool group payload', () => {
    const editor = createLexicalTestEditor('tool-group-block-node-decorate-test', [ToolGroupBlockNode])
    let node!: ToolGroupBlockNode

    act(() => {
      editor.update(() => {
        node = $createToolGroupBlockNode({ tools })
      })
    })

    render(node.decorate())

    expect(screen.getByTestId('tool-group-block-component')).toHaveTextContent('"provider":"openai/tools"')
    expect(screen.getByTestId('tool-group-block-component')).toHaveTextContent('"provider":"anthropic"')
  })
})
