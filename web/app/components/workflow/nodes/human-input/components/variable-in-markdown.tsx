import type * as React from 'react'
import type { FormInputItemDefault } from '../types'

const variableRegex = /\{\{#(.+?)#\}\}/g
const noteRegex = /\{\{#\$(.+?)#\}\}/g

type MarkdownNode = {
  type?: string
  value?: string
  tagName?: string
  properties?: Record<string, string>
  children?: MarkdownNode[]
}

type SplitMatchResult = {
  tagName: string
  properties: Record<string, string>
}

const splitTextNode = (
  value: string,
  regex: RegExp,
  createMatchNode: (match: RegExpExecArray) => SplitMatchResult,
) => {
  const parts: MarkdownNode[] = []
  let lastIndex = 0
  let match = regex.exec(value)

  while (match !== null) {
    if (match.index > lastIndex)
      parts.push({ type: 'text', value: value.slice(lastIndex, match.index) })

    const { tagName, properties } = createMatchNode(match)
    parts.push({
      type: 'element',
      tagName,
      properties,
      children: [],
    })

    lastIndex = match.index + match[0].length
    match = regex.exec(value)
  }

  if (!parts.length)
    return parts

  if (lastIndex < value.length)
    parts.push({ type: 'text', value: value.slice(lastIndex) })

  return parts
}

const visitTextNodes = (
  node: MarkdownNode,
  transform: (value: string, parent: MarkdownNode) => MarkdownNode[] | null,
) => {
  if (!node.children)
    return

  let index = 0
  while (index < node.children.length) {
    const child = node.children[index]
    if (child.type === 'text' && typeof child.value === 'string') {
      const nextNodes = transform(child.value, node)
      if (nextNodes) {
        node.children.splice(index, 1, ...nextNodes)
        index += nextNodes.length
        continue
      }
    }

    visitTextNodes(child, transform)
    index++
  }
}

const replaceNodeIdsWithNames = (path: string, nodeName: (nodeId: string) => string) => {
  return path.replace(/#([^#.]+)([.#])/g, (_, nodeId: string, separator: string) => {
    return `#${nodeName(nodeId)}${separator}`
  })
}

const formatVariablePath = (path: string) => {
  return path.replaceAll('.', '/')
    .replace('{{#', '{{')
    .replace('#}}', '}}')
}

export function rehypeVariable() {
  return (tree: MarkdownNode) => {
    visitTextNodes(tree, (value) => {
      variableRegex.lastIndex = 0
      noteRegex.lastIndex = 0
      if (!variableRegex.test(value) || noteRegex.test(value))
        return null

      variableRegex.lastIndex = 0
      return splitTextNode(value, variableRegex, match => ({
        tagName: 'variable',
        properties: { dataPath: match[0].trim() },
      }))
    })
  }
}

export function rehypeNotes() {
  return (tree: MarkdownNode) => {
    visitTextNodes(tree, (value, parent) => {
      noteRegex.lastIndex = 0
      if (!noteRegex.test(value))
        return null

      noteRegex.lastIndex = 0
      parent.tagName = 'div'
      return splitTextNode(value, noteRegex, (match) => {
        const name = match[0].split('.').slice(-1)[0].replace('#}}', '')
        return {
          tagName: 'section',
          properties: { dataName: name },
        }
      })
    })
  }
}

export const Variable: React.FC<{ path: string }> = ({ path }) => {
  return (
    <span className="text-text-accent">
      {formatVariablePath(path)}
    </span>
  )
}

export const Note: React.FC<{ defaultInput: FormInputItemDefault, nodeName: (nodeId: string) => string }> = ({ defaultInput, nodeName }) => {
  const isVariable = defaultInput.type === 'variable'
  const path = `{{#${defaultInput.selector.join('.')}#}}`
  const newPath = path ? replaceNodeIdsWithNames(path, nodeName) : path
  return (
    <div className="my-3 rounded-[10px] bg-components-input-bg-normal px-2.5 py-2">
      {isVariable ? <Variable path={newPath} /> : <span>{defaultInput.value}</span>}
    </div>
  )
}
