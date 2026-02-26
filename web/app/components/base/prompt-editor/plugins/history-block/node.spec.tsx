import type { SerializedNode as SerializedHistoryBlockNode } from './node'
import { act } from '@testing-library/react'
import { $getNodeByKey, $getRoot } from 'lexical'
import {
  createLexicalTestEditor,
  expectInlineWrapperDom,
} from '../test-helpers'
import HistoryBlockComponent from './component'
import {
  $createHistoryBlockNode,
  $isHistoryBlockNode,
  HistoryBlockNode,

} from './node'

const createRoleName = (overrides?: { user?: string, assistant?: string }) => ({
  user: 'user-role',
  assistant: 'assistant-role',
  ...overrides,
})

const createTestEditor = () => {
  return createLexicalTestEditor('history-block-node-test', [HistoryBlockNode])
}

const createNodeInEditor = () => {
  const editor = createTestEditor()
  const roleName = createRoleName()
  const onEditRole = vi.fn()
  let node!: HistoryBlockNode
  let nodeKey = ''

  act(() => {
    editor.update(() => {
      node = $createHistoryBlockNode(roleName, onEditRole)
      $getRoot().append(node)
      nodeKey = node.getKey()
    })
  })

  return { editor, node, nodeKey, roleName, onEditRole }
}

describe('HistoryBlockNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should expose history block type and inline behavior', () => {
    const { node } = createNodeInEditor()

    expect(HistoryBlockNode.getType()).toBe('history-block')
    expect(node.isInline()).toBe(true)
    expect(node.getTextContent()).toBe('{{#histories#}}')
  })

  it('should clone into a new history block node with same role and handler', () => {
    const { editor, node, nodeKey } = createNodeInEditor()
    let cloned!: HistoryBlockNode

    act(() => {
      editor.update(() => {
        const currentNode = $getNodeByKey(nodeKey) as HistoryBlockNode
        cloned = HistoryBlockNode.clone(currentNode)
      })
    })

    expect(cloned).toBeInstanceOf(HistoryBlockNode)
    expect(cloned).not.toBe(node)
  })

  it('should create inline wrapper DOM with expected classes', () => {
    const { node } = createNodeInEditor()
    const dom = node.createDOM()

    expectInlineWrapperDom(dom)
  })

  it('should not update DOM', () => {
    const { node } = createNodeInEditor()

    expect(node.updateDOM()).toBe(false)
  })

  it('should decorate with history block component and expected props', () => {
    const { editor, nodeKey, roleName, onEditRole } = createNodeInEditor()
    let element!: React.JSX.Element

    act(() => {
      editor.update(() => {
        const currentNode = $getNodeByKey(nodeKey) as HistoryBlockNode
        element = currentNode.decorate()
      })
    })

    expect(element.type).toBe(HistoryBlockComponent)
    expect(element.props.nodeKey).toBe(nodeKey)
    expect(element.props.roleName).toEqual(roleName)
    expect(element.props.onEditRole).toBe(onEditRole)
  })

  it('should export and import JSON with role and edit handler', () => {
    const { editor, nodeKey, roleName, onEditRole } = createNodeInEditor()
    let serialized!: SerializedHistoryBlockNode
    let imported!: HistoryBlockNode
    let importedKey = ''
    const payload: SerializedHistoryBlockNode = {
      type: 'history-block',
      version: 1,
      roleName,
      onEditRole,
    }

    act(() => {
      editor.update(() => {
        const currentNode = $getNodeByKey(nodeKey) as HistoryBlockNode
        serialized = currentNode.exportJSON()
      })
    })

    act(() => {
      editor.update(() => {
        imported = HistoryBlockNode.importJSON(payload)
        $getRoot().append(imported)
        importedKey = imported.getKey()

        expect(imported.getRoleName()).toEqual(roleName)
        expect(imported.getOnEditRole()).toBe(onEditRole)
      })
    })

    expect(serialized.type).toBe('history-block')
    expect(serialized.version).toBe(1)
    expect(serialized.roleName).toEqual(roleName)
    expect(typeof serialized.onEditRole).toBe('function')
    expect(imported).toBeInstanceOf(HistoryBlockNode)
    expect(importedKey).not.toBe('')
  })

  it('should identify history block nodes using type guard', () => {
    const { node } = createNodeInEditor()

    expect($isHistoryBlockNode(node)).toBe(true)
    expect($isHistoryBlockNode(null)).toBe(false)
    expect($isHistoryBlockNode(undefined)).toBe(false)
  })

  it('should create a history block node instance from factory', () => {
    const editor = createTestEditor()
    const roleName = createRoleName({
      user: 'custom-user',
      assistant: 'custom-assistant',
    })
    const onEditRole = vi.fn()
    let node!: HistoryBlockNode

    act(() => {
      editor.update(() => {
        node = $createHistoryBlockNode(roleName, onEditRole)

        expect(node.getRoleName()).toEqual(roleName)
        expect(node.getOnEditRole()).toBe(onEditRole)
      })
    })

    expect(node).toBeInstanceOf(HistoryBlockNode)
  })
})
