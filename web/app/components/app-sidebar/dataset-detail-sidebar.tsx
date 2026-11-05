'use client'

import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import { useIsMobile } from '@/hooks/use-media-query'
import { usePathname } from '@/next/navigation'
import DatasetDetailSection from './dataset-detail-section'
import { DatasetDetailTop } from './dataset-detail-top'

export function DatasetDetailSidebar() {
  const isMobile = useIsMobile()
  const pathname = usePathname()

  return (
    <DetailSidebarFrame
      compact={isMobile && pathname.endsWith('/settings')}
      renderTop={({ expand, onToggle }) => <DatasetDetailTop expand={expand} onToggle={onToggle} />}
      renderSection={({ expand }) => <DatasetDetailSection expand={expand} />}
    />
  )
}
