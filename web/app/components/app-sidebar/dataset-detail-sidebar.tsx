'use client'

import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { usePathname } from '@/next/navigation'
import DatasetDetailSection from './dataset-detail-section'
import { DatasetDetailTop } from './dataset-detail-top'

export function DatasetDetailSidebar() {
  const media = useBreakpoints()
  const pathname = usePathname()

  return (
    <DetailSidebarFrame
      compact={media === MediaType.mobile && pathname.endsWith('/settings')}
      renderTop={({ expand, onToggle }) => <DatasetDetailTop expand={expand} onToggle={onToggle} />}
      renderSection={({ expand }) => <DatasetDetailSection expand={expand} />}
    />
  )
}
