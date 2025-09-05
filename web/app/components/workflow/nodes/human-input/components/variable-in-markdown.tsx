import type React from 'react'
import type { FormInputItemPlaceholder } from '../types'

const variableRegex = /\{\{#(.+?)#\}\}/g
const noteRegex = /\{\{#\$(.+?)#\}\}/g

export function rehypeVariable() {
  return (tree: any) => {
    const iterate = (node: any, index: number, parent: any) => {
      const value = node.value

      variableRegex.lastIndex = 0
      if(node.type === 'text' && variableRegex.test(value) && !noteRegex.test(value)) {
        let m: RegExpExecArray | null
        let last = 0
        const parts: any[] = []
        variableRegex.lastIndex = 0
        while ((m = variableRegex.exec(value))) {
          if (m.index > last)
            parts.push({ type: 'text', value: value.slice(last, m.index) })

          parts.push({
            type: 'element',
            tagName: 'variable',
            properties: { 'data-path': m[0].trim() },
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

export function rehypeNotes() {
  return (tree: any) => {
    const iterate = (node: any, index: number, parent: any) => {
      const value = node.value

      noteRegex.lastIndex = 0
      if(node.type === 'text' && noteRegex.test(value)) {
        let m: RegExpExecArray | null
        let last = 0
        const parts: any[] = []
        noteRegex.lastIndex = 0
        while ((m = noteRegex.exec(value))) {
          if (m.index > last)
            parts.push({ type: 'text', value: value.slice(last, m.index) })

          parts.push({
            type: 'element',
            tagName: 'h2',
            properties: {},
            children: [
              {
                type: 'text',
                value: 'Notes',
              },
            ],
          })
          const name = m[0].split('.').slice(-1)[0].replace('#}}', '')
          parts.push({
            type: 'element',
            tagName: 'section',
            properties: { 'data-name': name },
            children: [],
          })

          last = m.index + m[0].length
        }

        if (parts.length) {
          if (last < value.length)
            parts.push({ type: 'text', value: value.slice(last) })

          parent.children.splice(index, 1, ...parts)
          parent.tagName = 'div' // h2 can not in p
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

export const Note: React.FC<{ placeholder: FormInputItemPlaceholder }> = ({ placeholder }) => {
  const isVariable = placeholder.type === 'variable'
  return (
    <div className='mt-3 rounded-[10px] bg-components-input-bg-normal px-2.5 py-2'>
      {isVariable ? <Variable path={`{{${placeholder.selector.join('.')}}}`} /> : <span>{placeholder.value}</span>}
    </div>
  )
}
