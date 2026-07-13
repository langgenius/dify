'use client'

import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import AppDetailSection from './app-detail-section'
import AppDetailTop from './app-detail-top'

export function AppDetailSidebar() {
  return (
    <DetailSidebarFrame
      renderTop={({ expand, onToggle }) => <AppDetailTop expand={expand} onToggle={onToggle} />}
      renderSection={({ expand }) => <AppDetailSection expand={expand} />}
    />
  )
}
