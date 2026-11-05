'use client'

import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import { useIsBelowDesktop } from '@/hooks/use-media-query'
import { AgentDetailSection, AgentDetailTop } from './navigation'

export function AgentDetailSidebar() {
  const isBelowDesktop = useIsBelowDesktop()

  return (
    <DetailSidebarFrame
      compact={isBelowDesktop}
      renderTop={({ expand, onToggle }) => <AgentDetailTop expand={expand} onToggle={onToggle} />}
      renderSection={({ expand }) => <AgentDetailSection expand={expand} />}
    />
  )
}
