import type { ReactNode } from 'react'
import { isValidElement } from 'react'

export function getTextFromNode(node: ReactNode): string | undefined {
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint')
    return String(node)

  if (Array.isArray(node)) {
    const text = node.map(getTextFromNode).filter(Boolean).join('')
    return text || undefined
  }

  if (isValidElement<{ children?: ReactNode }>(node)) return getTextFromNode(node.props.children)
}

export function hasTitleInNode(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(hasTitleInNode)

  if (!isValidElement<{ children?: ReactNode; title?: string }>(node)) return false
  if (node.props.title) return true
  return hasTitleInNode(node.props.children)
}
