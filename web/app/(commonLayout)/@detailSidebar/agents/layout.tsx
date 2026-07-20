import type { ReactNode } from 'react'
import AgentsAccessGuard from '@/app/(commonLayout)/agents/agents-access-guard'

export default function Layout({ children }: { children: ReactNode }) {
  return <AgentsAccessGuard>{children}</AgentsAccessGuard>
}
