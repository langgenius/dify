'use client'

import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import DatasetDetailSection from './dataset-detail-section'
import DatasetDetailTop from './dataset-detail-top'

export function DatasetDetailSidebar() {
  return (
    <DetailSidebarFrame
      renderTop={({ expand, onToggle }) => <DatasetDetailTop expand={expand} onToggle={onToggle} />}
      renderSection={({ expand }) => <DatasetDetailSection expand={expand} />}
    />
  )
}
