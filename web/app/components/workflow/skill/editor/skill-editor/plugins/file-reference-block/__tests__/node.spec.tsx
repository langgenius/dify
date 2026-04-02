import { act, render, screen } from '@testing-library/react'
import { $createParagraphNode, $getRoot } from 'lexical'
import {
  createLexicalTestEditor,
} from '@/app/components/base/prompt-editor/plugins/test-helpers'
import {
  $createFileReferenceNode,
  $isFileReferenceNode,
  FileReferenceNode,
} from '../node'
import { buildFileReferenceToken } from '../utils'

vi.mock('../component', () => ({
  default: ({ nodeKey, resourceId }: { nodeKey: string, resourceId: string }) => (
    <div data-testid="file-reference-block">{`${nodeKey}:${resourceId}`}</div>
  ),
}))

const firstResourceId = '11111111-1111-4111-8111-111111111111'
const secondResourceId = '22222222-2222-4222-8222-222222222222'

describe('FileReferenceNode', () => {
  it('should expose lexical metadata and serialize its payload', () => {
    const editor = createLexicalTestEditor('file-reference-node-metadata-test', [FileReferenceNode])
    let node!: FileReferenceNode

    act(() => {
      editor.update(() => {
        node = $createFileReferenceNode({ resourceId: firstResourceId })
      })
    })

    const dom = node.createDOM()

    expect(FileReferenceNode.getType()).toBe('file-reference-block')
    expect(node.isInline()).toBe(true)
    expect(node.updateDOM()).toBe(false)
    expect(node.exportJSON()).toEqual({
      type: 'file-reference-block',
      version: 1,
      resourceId: firstResourceId,
    })
    expect(node.getTextContent()).toBe(buildFileReferenceToken(firstResourceId))
    expect($isFileReferenceNode(node)).toBe(true)
    expect($isFileReferenceNode(null)).toBe(false)
    expect($isFileReferenceNode(undefined)).toBe(false)
    expect(dom.tagName).toBe('SPAN')
    expect(dom).toHaveClass('inline-flex', 'items-center', 'align-middle')
  })

  it('should clone and import serialized nodes', () => {
    const editor = createLexicalTestEditor('file-reference-node-clone-test', [FileReferenceNode])
    let original!: FileReferenceNode
    let cloned!: FileReferenceNode
    let imported!: FileReferenceNode

    act(() => {
      editor.update(() => {
        original = $createFileReferenceNode({ resourceId: firstResourceId })
        cloned = FileReferenceNode.clone(original)
        imported = FileReferenceNode.importJSON({
          type: 'file-reference-block',
          version: 1,
          resourceId: secondResourceId,
        })
      })
    })

    expect(cloned).not.toBe(original)
    expect(cloned.exportJSON()).toEqual(original.exportJSON())
    expect(imported.exportJSON()).toEqual({
      type: 'file-reference-block',
      version: 1,
      resourceId: secondResourceId,
    })
  })

  it('should decorate and update its resource id inside editor state', () => {
    const editor = createLexicalTestEditor('file-reference-node-test', [FileReferenceNode])
    let node!: FileReferenceNode
    let updatedText = ''
    let updatedResourceId = ''

    act(() => {
      editor.update(() => {
        node = $createFileReferenceNode({ resourceId: firstResourceId })
      })
    })

    render(node.decorate())

    expect(screen.getByTestId('file-reference-block')).toHaveTextContent(firstResourceId)

    act(() => {
      editor.update(() => {
        const root = $getRoot()
        const paragraph = $createParagraphNode()
        const lexicalNode = $createFileReferenceNode({ resourceId: firstResourceId })

        paragraph.append(lexicalNode)
        root.append(paragraph)
        lexicalNode.setResourceId(secondResourceId)
        updatedText = lexicalNode.getTextContent()
        updatedResourceId = lexicalNode.exportJSON().resourceId
      })
    })

    expect(updatedText).toBe(buildFileReferenceToken(secondResourceId))
    expect(updatedResourceId).toBe(secondResourceId)
  })
})
