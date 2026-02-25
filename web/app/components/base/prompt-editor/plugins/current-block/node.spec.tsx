import { act } from '@testing-library/react'
import {
  $createParagraphNode,
  $getRoot,
} from 'lexical'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import {
  createLexicalTestEditor,
  expectInlineWrapperDom,
} from '../test-helpers'
import CurrentBlockComponent from './component'
import {
  $createCurrentBlockNode,
  $isCurrentBlockNode,
  CurrentBlockNode,
} from './node'

const createTestEditor = () => {
  return createLexicalTestEditor('current-block-node-test', [CurrentBlockNode])
}

const appendNodeToRoot = (node: CurrentBlockNode) => {
  const paragraph = $createParagraphNode()
  paragraph.append(node)
  $getRoot().append(paragraph)
}

describe('CurrentBlockNode', () => {
  describe('Node metadata', () => {
    it('should expose current block type, inline behavior, and text content', () => {
      const editor = createTestEditor()
      let isInline = false
      let textContent = ''
      let generatorType!: GeneratorType

      act(() => {
        editor.update(() => {
          const node = $createCurrentBlockNode(GeneratorType.prompt)
          appendNodeToRoot(node)

          isInline = node.isInline()
          textContent = node.getTextContent()
          generatorType = node.getGeneratorType()
        })
      })

      expect(CurrentBlockNode.getType()).toBe('current-block')
      expect(isInline).toBe(true)
      expect(textContent).toBe('{{#current#}}')
      expect(generatorType).toBe(GeneratorType.prompt)
    })

    it('should clone with the same key and generator type', () => {
      const editor = createTestEditor()
      let originalKey = ''
      let clonedKey = ''
      let clonedGeneratorType!: GeneratorType

      act(() => {
        editor.update(() => {
          const node = $createCurrentBlockNode(GeneratorType.code)
          appendNodeToRoot(node)

          const cloned = CurrentBlockNode.clone(node)
          originalKey = node.getKey()
          clonedKey = cloned.getKey()
          clonedGeneratorType = cloned.getGeneratorType()
        })
      })

      expect(clonedKey).toBe(originalKey)
      expect(clonedGeneratorType).toBe(GeneratorType.code)
    })
  })

  describe('DOM behavior', () => {
    it('should create inline wrapper DOM with expected classes', () => {
      const editor = createTestEditor()
      let node!: CurrentBlockNode

      act(() => {
        editor.update(() => {
          node = $createCurrentBlockNode(GeneratorType.prompt)
          appendNodeToRoot(node)
        })
      })

      const dom = node.createDOM()

      expectInlineWrapperDom(dom)
    })

    it('should not update DOM', () => {
      const editor = createTestEditor()
      let node!: CurrentBlockNode

      act(() => {
        editor.update(() => {
          node = $createCurrentBlockNode(GeneratorType.prompt)
          appendNodeToRoot(node)
        })
      })

      expect(node.updateDOM()).toBe(false)
    })
  })

  describe('Serialization and decoration', () => {
    it('should export and import JSON with generator type', () => {
      const editor = createTestEditor()
      let serialized!: ReturnType<CurrentBlockNode['exportJSON']>
      let importedSerialized!: ReturnType<CurrentBlockNode['exportJSON']>

      act(() => {
        editor.update(() => {
          const node = $createCurrentBlockNode(GeneratorType.prompt)
          appendNodeToRoot(node)
          serialized = node.exportJSON()

          const imported = CurrentBlockNode.importJSON({
            type: 'current-block',
            version: 1,
            generatorType: GeneratorType.code,
          })
          appendNodeToRoot(imported)
          importedSerialized = imported.exportJSON()
        })
      })

      expect(serialized).toEqual({
        type: 'current-block',
        version: 1,
        generatorType: GeneratorType.prompt,
      })
      expect(importedSerialized).toEqual({
        type: 'current-block',
        version: 1,
        generatorType: GeneratorType.code,
      })
    })

    it('should decorate with current block component and props', () => {
      const editor = createTestEditor()
      let nodeKey = ''
      let element!: ReturnType<CurrentBlockNode['decorate']>

      act(() => {
        editor.update(() => {
          const node = $createCurrentBlockNode(GeneratorType.code)
          appendNodeToRoot(node)
          nodeKey = node.getKey()
          element = node.decorate()
        })
      })

      expect(element.type).toBe(CurrentBlockComponent)
      expect(element.props).toEqual({
        nodeKey,
        generatorType: GeneratorType.code,
      })
    })
  })

  describe('Helpers', () => {
    it('should create current block node instance from factory', () => {
      const editor = createTestEditor()
      let node!: CurrentBlockNode

      act(() => {
        editor.update(() => {
          node = $createCurrentBlockNode(GeneratorType.prompt)
          appendNodeToRoot(node)
        })
      })

      expect(node).toBeInstanceOf(CurrentBlockNode)
    })

    it('should identify current block nodes using type guard helper', () => {
      const editor = createTestEditor()
      let node!: CurrentBlockNode

      act(() => {
        editor.update(() => {
          node = $createCurrentBlockNode(GeneratorType.prompt)
          appendNodeToRoot(node)
        })
      })

      expect($isCurrentBlockNode(node)).toBe(true)
      expect($isCurrentBlockNode(null)).toBe(false)
      expect($isCurrentBlockNode(undefined)).toBe(false)
    })
  })
})
