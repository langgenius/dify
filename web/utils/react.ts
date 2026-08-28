import type { ReactNode } from 'react'
import { isValidElement } from 'react'

export function getTextFromReactNode(node: ReactNode): string | undefined {
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint')
    return String(node)

  if (Array.isArray(node)) {
    const text = node.map(getTextFromReactNode).filter(Boolean).join('')
    return text || undefined
  }

  if (isValidElement<{ children?: ReactNode }>(node))
    return getTextFromReactNode(node.props.children)
}
