import type { Components } from 'react-markdown'
import DOMPurify from 'dompurify'
import ReactMarkdown from 'react-markdown'
import remarkDirective from 'remark-directive'
import { visit } from 'unist-util-visit'
import { validateDirectiveProps } from './components/markdown-with-directive-schema'
import WithIconCardItem from './components/with-icon-card-item'
import WithIconCardList from './components/with-icon-card-list'

type DirectiveNode = {
  type?: string
  name?: string
  attributes?: Record<string, unknown>
  data?: {
    hName?: string
    hProperties?: Record<string, string>
  }
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

const lineReg = /^(\s*:+[a-z][\w-]*(?:\[[^\]\n]*\])?)\s+((?:\{[^}\n]*\}\s*)+)$/i
const attrReg = /\{([^}\n]*)\}/g

function normalizeDirectiveAttributeBlocks(markdown: string): string {
  const lines = markdown.split('\n')

  return lines.map((line) => {
    const match = line.match(lineReg)
    if (!match)
      return line

    const directivePrefix = match[1]
    const attributeBlocks = match[2]
    const attrMatches = [...attributeBlocks.matchAll(attrReg)]
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
      if (!validateDirectiveProps(directiveName, attributes))
        isValid = false
    },
  )

  return isValid
}

const invalidTextReg = /^\s*:{2,}[a-z][\w-]*/im
function hasUnparsedDirectiveLikeText(tree: Parameters<typeof visit>[0]): boolean {
  let hasInvalidText = false

  visit(tree, 'text', (node) => {
    if (hasInvalidText)
      return

    const textNode = node as { value?: string }
    const value = textNode.value || ''
    if (invalidTextReg.test(value))
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
  withiconcardlist: WithIconCardList,
  withiconcarditem: WithIconCardItem,
} as unknown as Components

type MarkdownWithDirectiveProps = {
  markdown: string
}

function sanitizeMarkdownInput(markdown: string): string {
  if (!markdown)
    return ''

  if (typeof DOMPurify.sanitize === 'function') {
    return DOMPurify.sanitize(markdown, {
      ALLOWED_ATTR: [],
      ALLOWED_TAGS: [],
    })
  }

  return markdown
}

export function MarkdownWithDirective({ markdown }: MarkdownWithDirectiveProps) {
  const sanitizedMarkdown = sanitizeMarkdownInput(markdown)
  const normalizedMarkdown = normalizeDirectiveAttributeBlocks(sanitizedMarkdown)

  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkDirective, directivePlugin]}
      components={directiveComponents}
    >
      {normalizedMarkdown}
    </ReactMarkdown>
  )
}
