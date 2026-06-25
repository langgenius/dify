'use client'

import type { AppListCategory } from './app-type-filter-shared'
import dynamic from '@/next/dynamic'

const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), {
  ssr: false,
})
const CreateAppModal = dynamic(() => import('@/app/components/app/create-app-modal'), {
  ssr: false,
})
const CreateAppTemplateDialog = dynamic(() => import('@/app/components/app/create-app-dialog'), {
  ssr: false,
})

export function AppListCreationModals({
  canCreateApp,
  category,
  droppedDSLFile,
  showCreateFromDSLModal,
  showNewAppModal,
  showNewAppTemplateDialog,
  onPlanInfoChanged,
  onRefetch,
  onSetDroppedDSLFile,
  onSetShowCreateFromDSLModal,
  onSetShowNewAppModal,
  onSetShowNewAppTemplateDialog,
}: {
  canCreateApp: boolean
  category: AppListCategory
  droppedDSLFile?: File
  showCreateFromDSLModal: boolean
  showNewAppModal: boolean
  showNewAppTemplateDialog: boolean
  onPlanInfoChanged: () => void
  onRefetch: () => void
  onSetDroppedDSLFile: (file?: File) => void
  onSetShowCreateFromDSLModal: (show: boolean) => void
  onSetShowNewAppModal: (show: boolean) => void
  onSetShowNewAppTemplateDialog: (show: boolean) => void
}) {
  if (!canCreateApp)
    return null

  return (
    <>
      {showCreateFromDSLModal && (
        <CreateFromDSLModal
          show={showCreateFromDSLModal}
          onClose={() => {
            onSetShowCreateFromDSLModal(false)
            onSetDroppedDSLFile(undefined)
          }}
          onSuccess={() => {
            onSetShowCreateFromDSLModal(false)
            onSetDroppedDSLFile(undefined)
            onPlanInfoChanged()
            onRefetch()
          }}
          droppedFile={droppedDSLFile}
        />
      )}
      {showNewAppModal && (
        <CreateAppModal
          show={showNewAppModal}
          onClose={() => onSetShowNewAppModal(false)}
          onSuccess={() => {
            onPlanInfoChanged()
            onRefetch()
          }}
          onCreateFromTemplate={() => {
            onSetShowNewAppTemplateDialog(true)
            onSetShowNewAppModal(false)
          }}
          defaultAppMode={category !== 'all' ? category : undefined}
        />
      )}
      {showNewAppTemplateDialog && (
        <CreateAppTemplateDialog
          show={showNewAppTemplateDialog}
          onClose={() => onSetShowNewAppTemplateDialog(false)}
          onSuccess={() => {
            onPlanInfoChanged()
            onRefetch()
          }}
          onCreateFromBlank={() => {
            onSetShowNewAppModal(true)
            onSetShowNewAppTemplateDialog(false)
          }}
        />
      )}
    </>
  )
}
