'use client'

import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { AgentDetailSection, AgentDetailTop } from './navigation'

export function AgentDetailSidebar() {
  const media = useBreakpoints()

  return (
    <DetailSidebarFrame
      compact={media !== MediaType.pc}
      renderTop={({ expand, onToggle }) => <AgentDetailTop expand={expand} onToggle={onToggle} />}
      renderSection={({ expand }) => <AgentDetailSection expand={expand} />}
    />
  )
}
