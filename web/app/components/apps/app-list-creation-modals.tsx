'use client'

import type { AppType } from './app-type'
import dynamic from 'next/dynamic'

const BlankAppDialog = dynamic(() => import('@/features/app-creation/blank-dialog'), {
  ssr: false,
})
const CreateAppModal = dynamic(() => import('@/app/components/app/create-app-modal'), {
  ssr: false,
})
const CreateFromDSLModal = dynamic(() => import('@/features/app-creation/dsl-dialog'), {
  ssr: false,
})
const CreateAppTemplateDialog = dynamic(() => import('@/features/app-creation/template-dialog'), {
  ssr: false,
})

export type AppListCreationDialog =
  | { type: 'blank' }
  | { type: 'template' }
  | { type: 'dsl'; droppedFile?: File }
  | null

export function AppListCreationModals({
  canCreateApp,
  defaultMode,
  dialog,
  isBuilderEnabled,
  onClose,
  onOpenBlank,
  onOpenTemplate,
}: {
  canCreateApp: boolean
  defaultMode: AppType
  dialog: AppListCreationDialog
  isBuilderEnabled: boolean
  onClose: () => void
  onOpenBlank: () => void
  onOpenTemplate: () => void
}) {
  if (!canCreateApp) return null

  return (
    <>
      {dialog?.type === 'blank' &&
        (isBuilderEnabled ? (
          <BlankAppDialog
            key={defaultMode}
            defaultMode={defaultMode}
            onClose={onClose}
            onCreateTemplate={onOpenTemplate}
          />
        ) : (
          <CreateAppModal
            show
            defaultAppMode={defaultMode}
            onClose={onClose}
            onCreateFromTemplate={onOpenTemplate}
          />
        ))}
      {dialog?.type === 'dsl' && (
        <CreateFromDSLModal show onClose={onClose} droppedFile={dialog.droppedFile} />
      )}
      {dialog?.type === 'template' && (
        <CreateAppTemplateDialog
          legacyLayout={!isBuilderEnabled}
          show
          onClose={onClose}
          onCreateFromBlank={isBuilderEnabled ? undefined : onOpenBlank}
        />
      )}
    </>
  )
}
