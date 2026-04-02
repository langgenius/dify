import { act, render, screen } from '@testing-library/react'
import {
  createLexicalTestEditor,
} from '@/app/components/base/prompt-editor/plugins/test-helpers'
import {
  $createToolBlockNode,
  $isToolBlockNode,
  ToolBlockNode,
} from '../node'
import { buildToolToken } from '../utils'

vi.mock('../component', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="tool-block-component">{JSON.stringify(props)}</div>
  ),
}))

const payload = {
  provider: 'openai/tools',
  tool: 'search',
  configId: '11111111-1111-4111-8111-111111111111',
  label: 'Search',
  icon: 'ri-search-line',
  iconDark: {
    content: 'moon',
    background: '#000000',
  },
}

describe('ToolBlockNode', () => {
  it('should expose lexical metadata and serialize its payload', () => {
    const editor = createLexicalTestEditor('tool-block-node-metadata-test', [ToolBlockNode])
    let node!: ToolBlockNode

    act(() => {
      editor.update(() => {
        node = $createToolBlockNode(payload)
      })
    })

    const dom = node.createDOM()

    expect(ToolBlockNode.getType()).toBe('tool-block')
    expect(node.isInline()).toBe(true)
    expect(node.updateDOM()).toBe(false)
    expect(node.exportJSON()).toEqual({
      type: 'tool-block',
      version: 1,
      ...payload,
    })
    expect(node.getTextContent()).toBe(buildToolToken(payload))
    expect($isToolBlockNode(node)).toBe(true)
    expect($isToolBlockNode(null)).toBe(false)
    expect(dom.tagName).toBe('SPAN')
    expect(dom).toHaveClass('inline-flex', 'items-center', 'align-middle')
  })

  it('should clone and import serialized nodes', () => {
    const editor = createLexicalTestEditor('tool-block-node-clone-test', [ToolBlockNode])
    let original!: ToolBlockNode
    let cloned!: ToolBlockNode
    let imported!: ToolBlockNode

    act(() => {
      editor.update(() => {
        original = $createToolBlockNode(payload)
        cloned = ToolBlockNode.clone(original)
        imported = ToolBlockNode.importJSON({
          type: 'tool-block',
          version: 1,
          ...payload,
          label: 'Imported',
        })
      })
    })

    expect(cloned).not.toBe(original)
    expect(cloned.exportJSON()).toEqual(original.exportJSON())
    expect(imported.exportJSON()).toEqual({
      type: 'tool-block',
      version: 1,
      ...payload,
      label: 'Imported',
    })
  })

  it('should decorate the node with the tool block component payload', () => {
    const editor = createLexicalTestEditor('tool-block-node-decorate-test', [ToolBlockNode])
    let node!: ToolBlockNode

    act(() => {
      editor.update(() => {
        node = $createToolBlockNode(payload)
      })
    })

    render(node.decorate())

    expect(screen.getByTestId('tool-block-component')).toHaveTextContent('"provider":"openai/tools"')
    expect(screen.getByTestId('tool-block-component')).toHaveTextContent('"tool":"search"')
    expect(screen.getByTestId('tool-block-component')).toHaveTextContent('"label":"Search"')
  })
})
