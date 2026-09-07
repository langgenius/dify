'use client'

import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import { SnippetDetailSection } from './snippet-detail-section'
import { SnippetDetailTop } from './snippet-detail-top'

export function SnippetDetailSidebar() {
  return (
    <DetailSidebarFrame
      renderTop={({ expand, onToggle }) => <SnippetDetailTop expand={expand} onToggle={onToggle} />}
      renderSection={({ expand }) => <SnippetDetailSection expand={expand} />}
    />
  )
}
