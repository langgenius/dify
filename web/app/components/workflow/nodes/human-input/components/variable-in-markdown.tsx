import React from 'react'
import { visit } from 'unist-util-visit'

export function rehypeVariable() {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index: number, parent: any) => {
      if (!parent || parent.type !== 'element') return
      const tag = parent.tagName
      if (tag === 'code' || tag === 'pre') return

      const value: string = node.value
      const regex = /\{\{#\$(.+?)#\}\}/g
      let m: RegExpExecArray | null
      let last = 0
      const parts: any[] = []

      while ((m = regex.exec(value))) {
        if (m.index > last)
          parts.push({ type: 'text', value: value.slice(last, m.index) })

        parts.push({
          type: 'element',
          tagName: 'variable',
          properties: { path: m[1].trim() },
          children: [], // 也可放文本 children
        })
        last = m.index + m[0].length
      }

      if (!parts.length) return
      if (last < value.length)
        parts.push({ type: 'text', value: value.slice(last) })

      parent.children.splice(index, 1, ...parts)
    })
  }
}

export const Variable: React.FC<{ path: string }> = ({ path }) => {
  return <span style={{ color: 'red', fontWeight: 700 }}>{path}</span>
}
