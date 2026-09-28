'use client'

import dynamic from 'next/dynamic'

const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), {
  ssr: false,
})
const CreateAppTemplateDialog = dynamic(() => import('@/app/components/app/create-app-dialog'), {
  ssr: false,
})

export type AppListCreationDialog =
  | { type: 'template' }
  | { type: 'dsl'; droppedFile?: File }
  | null

export function AppListCreationModals({
  canCreateApp,
  dialog,
  onClose,
}: {
  canCreateApp: boolean
  dialog: AppListCreationDialog
  onClose: () => void
}) {
  if (!canCreateApp) return null

  return (
    <>
      {dialog?.type === 'dsl' && (
        <CreateFromDSLModal show onClose={onClose} droppedFile={dialog.droppedFile} />
      )}
      {dialog?.type === 'template' && <CreateAppTemplateDialog show onClose={onClose} />}
    </>
  )
}
