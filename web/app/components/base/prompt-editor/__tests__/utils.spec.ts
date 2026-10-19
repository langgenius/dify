import type { ParagraphNode, SerializedTextNode, TextNode as TextNodeType } from 'lexical'
import type { MenuTextMatch } from '../types'
import { $createParagraphNode, $getRoot, $setSelection, createEditor, TextNode } from 'lexical'
import { $createCustomTextNode, CustomTextNode } from '../plugins/custom-text/node'
import { $createQueryBlockNode, QueryBlockNode } from '../plugins/query-block/node'
import {
  $splitNodeContainingQuery,
  decoratorTransform,
  registerLexicalTextEntity,
  textToEditorState,
} from '../utils'

class MentionNode extends TextNode {
  static override getType() {
    return 'test-mention'
  }
  static override clone(node: MentionNode) {
    return new MentionNode(node.__text, node.__key)
  }
  static override importJSON(node: SerializedTextNode) {
    return new MentionNode(node.text)
  }
  override isTextEntity() {
    return true
  }
}

const createTestEditor = () =>
  createEditor({
    nodes: [
      CustomTextNode,
      MentionNode,
      QueryBlockNode,
      {
        replace: TextNode,
        with: (node: TextNode) => new CustomTextNode(node.__text),
        withKlass: CustomTextNode,
      },
    ],
    onError: (error) => {
      throw error
    },
  })

const matchMention = (text: string) => {
  const match = /@[a-z]+/.exec(text)
  return match ? { start: match.index, end: match.index + match[0].length } : null
}

const matchQuery = (text: string) => {
  const start = text.indexOf('{{#query#}}')
  return start < 0 ? null : { start, end: start + '{{#query#}}'.length }
}

function readChildren(editor: ReturnType<typeof createTestEditor>) {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getFirstChildOrThrow<ParagraphNode>()
      .getChildren()
      .map((node) => ({
        type: node.getType(),
        text: node.getTextContent(),
      })),
  )
}

describe('prompt editor text transforms', () => {
  it('replaces multiple mentions while preserving surrounding text and formatting', () => {
    const editor = createTestEditor()
    registerLexicalTextEntity(
      editor,
      matchMention,
      MentionNode,
      (node) => new MentionNode(node.getTextContent()),
    )
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createCustomTextNode('Hello @alice and @bob!').setFormat('bold'),
          ),
        )
      },
      { discrete: true },
    )

    expect(readChildren(editor)).toEqual([
      { type: 'custom-text', text: 'Hello ' },
      { type: 'test-mention', text: '@alice' },
      { type: 'custom-text', text: ' and ' },
      { type: 'test-mention', text: '@bob' },
      { type: 'custom-text', text: '!' },
    ])
    editor.getEditorState().read(() => {
      const nodes = $getRoot().getFirstChildOrThrow<ParagraphNode>().getChildren<TextNodeType>()
      expect(nodes.every((node) => node.hasFormat('bold'))).toBe(true)
    })
  })

  it('restores an edited invalid mention to plain text without losing its format', () => {
    const editor = createTestEditor()
    registerLexicalTextEntity(
      editor,
      matchMention,
      MentionNode,
      (node) => new MentionNode(node.getTextContent()),
    )
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(new MentionNode('@alice').setFormat('italic')),
        )
      },
      { discrete: true },
    )
    editor.update(
      () => {
        $getRoot()
          .getFirstChildOrThrow<ParagraphNode>()
          .getFirstChildOrThrow<TextNodeType>()
          .setTextContent('alice')
      },
      { discrete: true },
    )

    expect(readChildren(editor)).toEqual([{ type: 'custom-text', text: 'alice' }])
    editor.getEditorState().read(() => {
      expect(
        $getRoot()
          .getFirstChildOrThrow<ParagraphNode>()
          .getFirstChildOrThrow<TextNodeType>()
          .hasFormat('italic'),
      ).toBe(true)
    })
  })

  it('extends a mention with typed text and leaves the remaining punctuation intact', () => {
    const editor = createTestEditor()
    registerLexicalTextEntity(
      editor,
      matchMention,
      MentionNode,
      (node) => new MentionNode(node.getTextContent()),
    )
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(new MentionNode('@al'), $createCustomTextNode('ice!')),
        )
      },
      { discrete: true },
    )

    expect(readChildren(editor)).toEqual([
      { type: 'test-mention', text: '@alice' },
      { type: 'custom-text', text: '!' },
    ])
  })

  it('stops transforming new text after unregistering', () => {
    const editor = createTestEditor()
    const unregister = registerLexicalTextEntity(
      editor,
      matchMention,
      MentionNode,
      (node) => new MentionNode(node.getTextContent()),
    )
    unregister.forEach((remove) => remove())
    editor.update(
      () => {
        $getRoot().append($createParagraphNode().append($createCustomTextNode('@alice')))
      },
      { discrete: true },
    )

    expect(readChildren(editor)).toEqual([{ type: 'custom-text', text: '@alice' }])
  })

  it.each([false, true])(
    'handles adjacent decorator tokens with allowAdjacentMatches=%s',
    (allowAdjacentMatches) => {
      const editor = createTestEditor()
      editor.update(
        () => {
          const node = $createCustomTextNode('{{#query#}}{{#query#}}')
          $getRoot().append($createParagraphNode().append(node))
          decoratorTransform(node, matchQuery, () => $createQueryBlockNode(), {
            allowAdjacentMatches,
          })
        },
        { discrete: true },
      )

      expect(readChildren(editor)).toEqual(
        allowAdjacentMatches
          ? [
              { type: 'query-block', text: '{{#query#}}' },
              { type: 'query-block', text: '{{#query#}}' },
            ]
          : [{ type: 'custom-text', text: '{{#query#}}{{#query#}}' }],
      )
    },
  )

  it('preserves text on both sides of decorator replacements', () => {
    const editor = createTestEditor()
    editor.update(
      () => {
        const node = $createCustomTextNode('Before {{#query#}} after')
        $getRoot().append($createParagraphNode().append(node))
        decoratorTransform(node, matchQuery, () => $createQueryBlockNode())
      },
      { discrete: true },
    )

    expect(readChildren(editor)).toEqual([
      { type: 'custom-text', text: 'Before ' },
      { type: 'query-block', text: '{{#query#}}' },
      { type: 'custom-text', text: ' after' },
    ])
  })
})

describe('$splitNodeContainingQuery', () => {
  const match: MenuTextMatch = { leadOffset: 0, matchingString: 'abc', replaceableString: '@abc' }

  it.each(['@abc tail', 'Hello @abc tail'])(
    'isolates the query before the cursor in %s',
    (text) => {
      const editor = createTestEditor()
      editor.update(
        () => {
          const node = $createCustomTextNode(text)
          const paragraph = $createParagraphNode().append(node)
          $getRoot().append(paragraph)
          const cursor = text.indexOf(' tail')
          node.select(cursor, cursor)

          const query = $splitNodeContainingQuery(match)

          expect(query?.getTextContent()).toBe('@abc')
          expect(query?.getNextSibling()?.getTextContent()).toBe(' tail')
          expect(paragraph.getTextContent()).toBe(text)
        },
        { discrete: true },
      )
    },
  )

  it.each(['none', 'expanded', 'element', 'token', 'too-short'] as const)(
    'does not split an ineligible %s selection',
    (selection) => {
      const editor = createTestEditor()
      editor.update(
        () => {
          const node = $createCustomTextNode(selection === 'too-short' ? '@' : '@abc')
          const paragraph = $createParagraphNode().append(node)
          $getRoot().append(paragraph)
          node.selectEnd()
          if (selection === 'none') $setSelection(null)
          if (selection === 'expanded') node.select(0, 4)
          if (selection === 'element') paragraph.select(0, 0)
          if (selection === 'token') node.setMode('token')

          expect($splitNodeContainingQuery(match)).toBeNull()
          expect(paragraph.getChildren()).toEqual([node])
        },
        { discrete: true },
      )
    },
  )
})

describe('textToEditorState', () => {
  it.each(['', 'Hello', 'first\n\nlast', '你好\n🙂\n'])(
    'round trips paragraphs through Lexical: %j',
    (text) => {
      const editor = createTestEditor()
      const state = editor.parseEditorState(textToEditorState(text))

      state.read(() => {
        expect(
          $getRoot()
            .getChildren()
            .map((node) => node.getTextContent()),
        ).toEqual(text.split('\n'))
      })
    },
  )
})
