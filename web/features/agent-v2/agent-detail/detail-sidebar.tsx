'use client'

import { useMediaQuery } from '@langgenius/dify-ui/use-media-query'
import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import { AgentDetailSection, AgentDetailTop } from './navigation'

export function AgentDetailSidebar() {
  const isBelowMd = useMediaQuery('(width < 48rem)', {})

  return (
    <DetailSidebarFrame
      compact={isBelowMd}
      renderTop={({ expand, onToggle }) => <AgentDetailTop expand={expand} onToggle={onToggle} />}
      renderSection={({ expand }) => <AgentDetailSection expand={expand} />}
    />
  )
}
