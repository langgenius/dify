'use client'
import type { AnchorHTMLAttributes, ClassAttributes, ReactNode } from 'react'
import type { Components, StreamdownProps } from 'streamdown'
import DOMPurify from 'dompurify'
import remarkDirective from 'remark-directive'
import { defaultRehypePlugins, Streamdown } from 'streamdown'
import { visit } from 'unist-util-visit'
import { validateDirectiveProps } from './components/markdown-with-directive-schema'
import WithIconCardItem from './components/with-icon-card-item'
import WithIconCardList from './components/with-icon-card-list'

// Adapter to map generic props to WithIconListProps
function WithIconCardListAdapter(props: Record<string, unknown>) {
  // Extract expected props, fallback to undefined if not present
  const { children, className } = props
  return (
    <WithIconCardList
      children={children as ReactNode}
      className={typeof className === 'string' ? className : undefined}
    />
  )
}

// Adapter to map generic props to WithIconCardItemProps
function WithIconCardItemAdapter(props: Record<string, unknown>) {
  const { icon, className, children } = props
  return (
    <WithIconCardItem
      icon={typeof icon === 'string' ? icon : ''}
      className={typeof className === 'string' ? className : undefined}
    >
      {children as ReactNode}
    </WithIconCardItem>
  )
}

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

// Move the regex to module scope to avoid recompilation
const DIRECTIVE_ATTRIBUTE_BLOCK_REGEX = /^(\s*:+[a-z][\w-]*(?:\[[^\]\n]*\])?)\s+((?:\{[^}\n]*\}\s*)+)$/i
const ATTRIBUTE_BLOCK_REGEX = /\{([^}\n]*)\}/g
type PluggableList = NonNullable<StreamdownProps['rehypePlugins']>
type Pluggable = PluggableList[number]
type AttributeDefinition = string | [string, ...(string | boolean | RegExp)[]]
type SanitizeSchema = {
  tagNames?: string[]
  attributes?: Record<string, AttributeDefinition[]>
  required?: Record<string, Record<string, unknown>>
  clobber?: string[]
  clobberPrefix?: string
  [key: string]: unknown
}

const DIRECTIVE_ALLOWED_TAGS: Record<string, AttributeDefinition[]> = {
  withiconcardlist: ['className'],
  withiconcarditem: ['icon', 'className'],
}

function buildDirectiveRehypePlugins(): PluggableList {
  const [sanitizePlugin, defaultSanitizeSchema]
    = defaultRehypePlugins.sanitize as [Pluggable, SanitizeSchema]

  const tagNames = new Set([
    ...(defaultSanitizeSchema.tagNames ?? []),
    ...Object.keys(DIRECTIVE_ALLOWED_TAGS),
  ])

  const attributes: Record<string, AttributeDefinition[]> = {
    ...defaultSanitizeSchema.attributes,
  }

  for (const [tagName, allowedAttributes] of Object.entries(DIRECTIVE_ALLOWED_TAGS))
    attributes[tagName] = [...(attributes[tagName] ?? []), ...allowedAttributes]

  const sanitizeSchema: SanitizeSchema = {
    ...defaultSanitizeSchema,
    tagNames: [...tagNames],
    attributes,
  }

  return [
    defaultRehypePlugins.raw!,
    [sanitizePlugin, sanitizeSchema] as Pluggable,
    defaultRehypePlugins.harden!,
  ]
}

const directiveRehypePlugins = buildDirectiveRehypePlugins()

function normalizeDirectiveAttributeBlocks(markdown: string): string {
  const lines = markdown.split('\n')

  return lines.map((line) => {
    const match = line.match(DIRECTIVE_ATTRIBUTE_BLOCK_REGEX)
    if (!match)
      return line

    const directivePrefix = match[1]
    const attributeBlocks = match[2]
    const attrMatches = [...attributeBlocks!.matchAll(ATTRIBUTE_BLOCK_REGEX)]
    if (attrMatches.length === 0)
      return line

    const mergedAttributes = attrMatches
      .map(result => result[1]!.trim())
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

const UNPARSED_DIRECTIVE_LIKE_TEXT_REGEX = /^\s*:{2,}[a-z][\w-]*/im

function hasUnparsedDirectiveLikeText(tree: Parameters<typeof visit>[0]): boolean {
  let hasInvalidText = false

  visit(tree, 'text', (node) => {
    if (hasInvalidText)
      return

    const textNode = node as { value?: string }
    const value = textNode.value || ''
    if (UNPARSED_DIRECTIVE_LIKE_TEXT_REGEX.test(value))
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

const directiveComponents: Components = {
  a: (props) => {
    const { children, href } = props as ClassAttributes<HTMLAnchorElement> & AnchorHTMLAttributes<HTMLAnchorElement>

    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-text-accent"
        style={{ textDecoration: 'none' }}
      >
        {children}
      </a>
    )
  },
  withiconcardlist: WithIconCardListAdapter,
  withiconcarditem: WithIconCardItemAdapter,
}

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

  if (!normalizedMarkdown)
    return null

  return (
    <div className="markdown-body">
      <Streamdown
        mode="static"
        remarkPlugins={[remarkDirective, directivePlugin]}
        rehypePlugins={directiveRehypePlugins}
        components={directiveComponents}
      >
        {normalizedMarkdown}
      </Streamdown>
    </div>

  )
}
