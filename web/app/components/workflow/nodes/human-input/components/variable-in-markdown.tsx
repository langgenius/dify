import type React from 'react'

const regex = /\{\{#(.+?)#\}\}/g

export function rehypeVariable() {
  return (tree: any) => {
    const iterate = (node: any, index: number, parent: any) => {
      const value = node.value

      regex.lastIndex = 0
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
            tagName: 'variable',
            properties: { path: m[0].trim() },
            children: [],
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
        let i = 0
        // Caution: can not use forEach. Because the length of tree.children may be changed because of change content: parent.children.splice(index, 1, ...parts)
        while(i < node.children.length) {
          iterate(node.children[i], i, node)
          i++
        }
      }
    }
    let i = 0
    // Caution: can not use forEach. Because the length of tree.children may be changed because of change content: parent.children.splice(index, 1, ...parts)
    while(i < tree.children.length) {
      iterate(tree.children[i], i, tree)
      i++
    }
  }
}

export const Variable: React.FC<{ path: string }> = ({ path }) => {
  return <span className='text-text-accent'>{
    path.replaceAll('.', '/')
      .replace('{{#', '{{')
      .replace('#}}', '}}')}</span>
}
