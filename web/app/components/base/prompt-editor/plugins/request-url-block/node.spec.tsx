import { act } from '@testing-library/react'
import {
  createLexicalTestEditor,
  expectInlineWrapperDom,
} from '../test-helpers'
import RequestURLBlockComponent from './component'
import {
  $createRequestURLBlockNode,
  $isRequestURLBlockNode,
  RequestURLBlockNode,
} from './node'

describe('RequestURLBlockNode', () => {
  const createTestEditor = () => {
    return createLexicalTestEditor('request-url-block-node-test', [RequestURLBlockNode])
  }

  const createNodeInEditor = () => {
    const editor = createTestEditor()
    let node!: RequestURLBlockNode

    act(() => {
      editor.update(() => {
        node = $createRequestURLBlockNode()
      })
    })

    return { editor, node }
  }

  describe('Node metadata', () => {
    it('should expose request URL block type and inline behavior', () => {
      const { node } = createNodeInEditor()

      expect(RequestURLBlockNode.getType()).toBe('request-url-block')
      expect(node.isInline()).toBe(true)
      expect(node.getTextContent()).toBe('{{#url#}}')
    })

    it('should clone with the same key', () => {
      const { editor, node } = createNodeInEditor()
      let cloned!: RequestURLBlockNode

      act(() => {
        editor.update(() => {
          cloned = RequestURLBlockNode.clone(node)
        })
      })

      expect(cloned).toBeInstanceOf(RequestURLBlockNode)
      expect(cloned.getKey()).toBe(node.getKey())
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
      let imported!: RequestURLBlockNode

      act(() => {
        editor.update(() => {
          imported = RequestURLBlockNode.importJSON()
        })
      })

      expect(serialized).toEqual({
        type: 'request-url-block',
        version: 1,
      })
      expect(imported).toBeInstanceOf(RequestURLBlockNode)
    })

    it('should decorate with request URL block component and node key', () => {
      const { node } = createNodeInEditor()
      const element = node.decorate()

      expect(element.type).toBe(RequestURLBlockComponent)
      expect(element.props).toEqual({ nodeKey: node.getKey() })
    })
  })

  describe('Helpers', () => {
    it('should create request URL block node instance from factory', () => {
      const { node } = createNodeInEditor()

      expect(node).toBeInstanceOf(RequestURLBlockNode)
    })

    it('should identify request URL block nodes using type guard', () => {
      const { node } = createNodeInEditor()

      expect($isRequestURLBlockNode(node)).toBe(true)
      expect($isRequestURLBlockNode(null)).toBe(false)
      expect($isRequestURLBlockNode(undefined)).toBe(false)
    })
  })
})
