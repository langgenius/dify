import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkDirective from 'remark-directive'
import { visit } from 'unist-util-visit'
import { WithIconItem, WithIconList } from './markdown-with-directive-components'
import { directivePropsSchemas } from './markdown-with-directive-schema'

type DirectiveNode = {
  type?: string
  name?: string
  attributes?: Record<string, unknown>
  data?: {
    hName?: string
    hProperties?: Record<string, string>
  }
}

type DirectiveName = keyof typeof directivePropsSchemas

function isDirectiveName(name: string): name is DirectiveName {
  return Object.hasOwn(directivePropsSchemas, name)
}

function isValidDirectiveProps(name: string, attributes: Record<string, string>): boolean {
  if (!isDirectiveName(name))
    return false

  return directivePropsSchemas[name].safeParse(attributes).success
}

type MdastRoot = {
  type: 'root'
  children: Array<{
    type: string
    children?: Array<{ type: string, value?: string }>
    value?: string
  }>
}

function isMdastRoot(node: Parameters<typeof visit>[0]): node is MdastRoot {
  if (typeof node !== 'object' || node === null)
    return false

  const candidate = node as { type?: unknown, children?: unknown }
  return candidate.type === 'root' && Array.isArray(candidate.children)
}

function normalizeDirectiveAttributeBlocks(markdown: string): string {
  const lines = markdown.split('\n')

  return lines.map((line) => {
    const match = line.match(/^(\s*:+[a-z][\w-]*(?:\[[^\]\n]*\])?)\s+((?:\{[^}\n]*\}\s*)+)$/i)
    if (!match)
      return line

    const directivePrefix = match[1]
    const attributeBlocks = match[2]
    const attrMatches = [...attributeBlocks.matchAll(/\{([^}\n]*)\}/g)]
    if (attrMatches.length === 0)
      return line

    const mergedAttributes = attrMatches
      .map(result => result[1].trim())
      .filter(Boolean)
      .join(' ')

    return mergedAttributes
      ? `${directivePrefix}{${mergedAttributes}}`
      : directivePrefix
  }).join('\n')
}

function normalizeDirectiveAttributes(attributes?: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {}

  if (!attributes)
    return normalized

  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === 'string')
      normalized[key] = value
  }

  return normalized
}

function isValidDirectiveAst(tree: Parameters<typeof visit>[0]): boolean {
  let isValid = true

  visit(
    tree,
    ['textDirective', 'leafDirective', 'containerDirective'],
    (node) => {
      if (!isValid)
        return

      const directiveNode = node as DirectiveNode
      const directiveName = directiveNode.name?.toLowerCase()
      if (!directiveName) {
        isValid = false
        return
      }

      const attributes = normalizeDirectiveAttributes(directiveNode.attributes)
      if (!isValidDirectiveProps(directiveName, attributes))
        isValid = false
    },
  )

  return isValid
}

function hasUnparsedDirectiveLikeText(tree: Parameters<typeof visit>[0]): boolean {
  let hasInvalidText = false

  visit(tree, 'text', (node) => {
    if (hasInvalidText)
      return

    const textNode = node as { value?: string }
    const value = textNode.value || ''
    if (/^\s*:{2,}[a-z][\w-]*/im.test(value))
      hasInvalidText = true
  })

  return hasInvalidText
}

function replaceWithInvalidContent(tree: Parameters<typeof visit>[0]) {
  if (!isMdastRoot(tree))
    return

  const root = tree
  root.children = [
    {
      type: 'paragraph',
      children: [
        {
          type: 'text',
          value: 'invalid content',
        },
      ],
    },
  ]
}

function directivePlugin() {
  return (tree: Parameters<typeof visit>[0]) => {
    if (!isValidDirectiveAst(tree) || hasUnparsedDirectiveLikeText(tree)) {
      replaceWithInvalidContent(tree)
      return
    }

    visit(
      tree,
      ['textDirective', 'leafDirective', 'containerDirective'],
      (node) => {
        const directiveNode = node as DirectiveNode
        const attributes = normalizeDirectiveAttributes(directiveNode.attributes)
        const hProperties: Record<string, string> = { ...attributes }

        if (hProperties.class) {
          hProperties.className = hProperties.class
          delete hProperties.class
        }

        const data = directiveNode.data || (directiveNode.data = {})
        data.hName = directiveNode.name?.toLowerCase()
        data.hProperties = hProperties
      },
    )
  }
}

const directiveComponents = {
  withiconlist: WithIconList,
  withiconitem: WithIconItem,
} as unknown as Components

type MarkdownWithDirectiveProps = {
  markdown: string
}

export function MarkdownWithDirective({ markdown }: MarkdownWithDirectiveProps) {
  const normalizedMarkdown = normalizeDirectiveAttributeBlocks(markdown)

  return (
    <ReactMarkdown
      remarkPlugins={[remarkDirective, directivePlugin]}
      components={directiveComponents}
    >
      {normalizedMarkdown}
    </ReactMarkdown>
  )
}
