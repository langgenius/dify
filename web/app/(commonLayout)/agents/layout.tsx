import type { ReactNode } from 'react'
import AgentsAccessGuard from './agents-access-guard'
import { guardAgentV2Route } from './feature-guard'

export default function Layout({ children }: { children: ReactNode }) {
  guardAgentV2Route()

  return <AgentsAccessGuard>{children}</AgentsAccessGuard>
}
