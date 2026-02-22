import { act } from '@testing-library/react'
import { createEditor } from 'lexical'
import LastRunBlockComponent from './component'
import {
  $createLastRunBlockNode,
  $isLastRunBlockNode,
  LastRunBlockNode,
} from './node'

const createTestEditor = () => {
  return createEditor({
    namespace: 'last-run-block-node-test',
    onError: (error: Error) => {
      throw error
    },
    nodes: [LastRunBlockNode],
  })
}

const createNodeInEditor = () => {
  const editor = createTestEditor()
  let node!: LastRunBlockNode

  act(() => {
    editor.update(() => {
      node = $createLastRunBlockNode()
    })
  })

  return { editor, node }
}

describe('LastRunBlockNode', () => {
  describe('Node metadata', () => {
    it('should expose last run block type and inline behavior', () => {
      const { node } = createNodeInEditor()

      expect(LastRunBlockNode.getType()).toBe('last-run-block')
      expect(node.isInline()).toBe(true)
      expect(node.getTextContent()).toBe('{{#last_run#}}')
    })

    it('should clone with the same key', () => {
      const { editor, node } = createNodeInEditor()
      let cloned!: LastRunBlockNode

      act(() => {
        editor.update(() => {
          cloned = LastRunBlockNode.clone(node)
        })
      })

      expect(cloned).toBeInstanceOf(LastRunBlockNode)
      expect(cloned.getKey()).toBe(node.getKey())
      expect(cloned).not.toBe(node)
    })
  })

  describe('DOM behavior', () => {
    it('should create inline wrapper DOM with expected classes', () => {
      const { node } = createNodeInEditor()
      const dom = node.createDOM()

      expect(dom.tagName).toBe('DIV')
      expect(dom).toHaveClass('inline-flex')
      expect(dom).toHaveClass('items-center')
      expect(dom).toHaveClass('align-middle')
    })

    it('should not update DOM', () => {
      const { node } = createNodeInEditor()

      expect(node.updateDOM()).toBe(false)
    })
  })

  describe('Serialization and decoration', () => {
    it('should export and import JSON', () => {
      const { editor, node } = createNodeInEditor()
      const serialized = node.exportJSON()
      let imported!: LastRunBlockNode

      act(() => {
        editor.update(() => {
          imported = LastRunBlockNode.importJSON()
        })
      })

      expect(serialized).toEqual({
        type: 'last-run-block',
        version: 1,
      })
      expect(imported).toBeInstanceOf(LastRunBlockNode)
    })

    it('should decorate with last run block component and node key', () => {
      const { node } = createNodeInEditor()
      const element = node.decorate()

      expect(element.type).toBe(LastRunBlockComponent)
      expect(element.props).toEqual({ nodeKey: node.getKey() })
    })
  })

  describe('Helpers', () => {
    it('should create last run block node instance from factory', () => {
      const { node } = createNodeInEditor()

      expect(node).toBeInstanceOf(LastRunBlockNode)
    })

    it('should identify last run block nodes using type guard helper', () => {
      const { node } = createNodeInEditor()

      expect($isLastRunBlockNode(node)).toBe(true)
      expect($isLastRunBlockNode(null)).toBe(false)
      expect($isLastRunBlockNode(undefined)).toBe(false)
    })
  })
})
