'use client'

import { DocumentMetadataDrawer } from './metadata/drawer'
import { DocumentModelRuntimeController } from './model-runtime-boundary'
import { DocumentPermissionRuntimeController } from './permission-recovery/runtime-boundary'
import { DocumentResultsSurface } from './results/surface'
import { DocumentsStateBoundary } from './state/boundary'
import { DocumentsProcessingTasksDrawer } from './tasks/documents-drawer'
import { DocumentTaskRuntimeController } from './tasks/runtime-boundary'

export function DocumentsPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  return (
    <DocumentsStateBoundary knowledgeSpaceId={knowledgeSpaceId}>
      <DocumentTaskRuntimeController />
      <DocumentPermissionRuntimeController />
      <DocumentModelRuntimeController />
      <DocumentResultsSurface />
      <DocumentsProcessingTasksDrawer />
      <DocumentMetadataDrawer />
    </DocumentsStateBoundary>
  )
}
