'use client'

import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import { DeploymentDetailSection, DeploymentDetailTop } from './deployment-sidebar'

export function DeploymentDetailSidebar() {
  return (
    <DetailSidebarFrame
      renderTop={({ expand, onToggle }) => (
        <DeploymentDetailTop expand={expand} onToggle={onToggle} />
      )}
      renderSection={({ expand }) => <DeploymentDetailSection expand={expand} />}
    />
  )
}
