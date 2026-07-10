import type { ReactNode } from 'react'
import { guardAgentV2Route } from './feature-guard'

export default function Layout({
  children,
}: {
  children: ReactNode
}) {
  guardAgentV2Route()

  return children
}
