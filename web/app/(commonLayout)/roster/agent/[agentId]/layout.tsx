import type { ReactNode } from 'react'
import { AgentDetailLayout } from '@/features/agent-v2/agent-detail/layout'

type LayoutProps = {
  children: ReactNode
  params: Promise<{ agentId: string }>
}

export default async function Layout({
  children,
  params,
}: LayoutProps) {
  const { agentId } = await params

  return (
    <AgentDetailLayout agentId={agentId}>
      {children}
    </AgentDetailLayout>
  )
}
