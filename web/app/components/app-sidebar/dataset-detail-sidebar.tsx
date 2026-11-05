'use client'

import { useMediaQuery } from '@langgenius/dify-ui/use-media-query'
import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import { usePathname } from '@/next/navigation'
import DatasetDetailSection from './dataset-detail-section'
import { DatasetDetailTop } from './dataset-detail-top'

export function DatasetDetailSidebar() {
  const isMobile = useMediaQuery('(width < 40rem)', {})
  const pathname = usePathname()

  return (
    <DetailSidebarFrame
      compact={isMobile && pathname.endsWith('/settings')}
      renderTop={({ expand, onToggle }) => <DatasetDetailTop expand={expand} onToggle={onToggle} />}
      renderSection={({ expand }) => <DatasetDetailSection expand={expand} />}
    />
  )
}
