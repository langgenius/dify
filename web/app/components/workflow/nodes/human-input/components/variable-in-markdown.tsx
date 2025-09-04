import React from 'react'

const regex = /\{\{#(.+?)#\}\}/g

export function rehypeVariable() {
  return (tree: any) => {
    const iterate = (node: any, index: number, parent: any) => {
      const value = node.value
      if(node.type === 'text')
        console.log(value)

      if(node.type === 'text' && regex.test(value)) {
        let m: RegExpExecArray | null
        let last = 0
        const parts: any[] = []
        regex.lastIndex = 0
        while ((m = regex.exec(value))) {
          if (m.index > last)
            parts.push({ type: 'text', value: value.slice(last, m.index) })

          parts.push({
            type: 'element',
            tagName: 'variable', // variable is also be cleared
            properties: { path: m[0].trim() },
          })
          last = m.index + m[0].length
        }

        if (parts.length) {
          if (last < value.length)
            parts.push({ type: 'text', value: value.slice(last) })

          parent.children.splice(index, 1, ...parts)
        }
      }
      if (node.children) {
        node.children.forEach((item: any, i: number) => {
          iterate(item, i, node)
        })
      }
    }
    tree.children.forEach((item: any, i: number) => {
      iterate(item, i, tree)
    }, tree)
  }
}

export const Variable: React.FC<{ path: string }> = ({ path }) => {
  return <span style={{ color: 'blue', fontWeight: 700 }}>{path.replaceAll('.', '/')}</span>
}
