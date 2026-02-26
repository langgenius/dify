import { act } from '@testing-library/react'
import {
  createLexicalTestEditor,
  expectInlineWrapperDom,
} from '../test-helpers'
import QueryBlockComponent from './component'
import {
  $createQueryBlockNode,
  $isQueryBlockNode,
  QueryBlockNode,
} from './node'

describe('QueryBlockNode', () => {
  const createTestEditor = () => {
    return createLexicalTestEditor('query-block-node-test', [QueryBlockNode])
  }

  const createNodeInEditor = () => {
    const editor = createTestEditor()
    let node!: QueryBlockNode

    act(() => {
      editor.update(() => {
        node = $createQueryBlockNode()
      })
    })

    return { editor, node }
  }

  describe('Node metadata', () => {
    it('should expose query block type and inline behavior', () => {
      const { node } = createNodeInEditor()

      expect(QueryBlockNode.getType()).toBe('query-block')
      expect(node.isInline()).toBe(true)
      expect(node.getTextContent()).toBe('{{#query#}}')
    })

    it('should clone into a new query block node', () => {
      const { editor, node } = createNodeInEditor()
      let cloned!: QueryBlockNode

      act(() => {
        editor.update(() => {
          cloned = QueryBlockNode.clone()
        })
      })

      expect(cloned).toBeInstanceOf(QueryBlockNode)
      expect(cloned).not.toBe(node)
    })
  })

  describe('DOM behavior', () => {
    it('should create inline wrapper DOM with expected classes', () => {
      const { node } = createNodeInEditor()
      const dom = node.createDOM()

      expectInlineWrapperDom(dom)
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
      let imported!: QueryBlockNode

      act(() => {
        editor.update(() => {
          imported = QueryBlockNode.importJSON()
        })
      })

      expect(serialized).toEqual({
        type: 'query-block',
        version: 1,
      })
      expect(imported).toBeInstanceOf(QueryBlockNode)
    })

    it('should decorate with query block component and node key', () => {
      const { node } = createNodeInEditor()
      const element = node.decorate()

      expect(element.type).toBe(QueryBlockComponent)
      expect(element.props).toEqual({ nodeKey: node.getKey() })
    })
  })

  describe('Helpers', () => {
    it('should create query block node instance from factory', () => {
      const { node } = createNodeInEditor()

      expect(node).toBeInstanceOf(QueryBlockNode)
    })

    it('should identify query block nodes using type guard', () => {
      const { node } = createNodeInEditor()

      expect($isQueryBlockNode(node)).toBe(true)
      expect($isQueryBlockNode(null)).toBe(false)
      expect($isQueryBlockNode(undefined)).toBe(false)
    })
  })
})
