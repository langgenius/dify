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
  defaultMode,
  dialog,
  onClose,
}: {
  canCreateApp: boolean
  /** Preselected app type for blank creation; `all` leaves the picker on its default. */
  defaultMode: AppListCategory
  dialog: AppListCreationDialog
  onClose: () => void
}) {
  if (!canCreateApp) return null
  const defaultAppModeResult = zPostAppsBody.shape.mode.safeParse(defaultMode)

  return (
    <>
      {dialog?.type === 'dsl' && (
        <CreateFromDSLModal show onClose={onClose} droppedFile={dialog.droppedFile} />
      )}
      {dialog?.type === 'template' && <CreateAppTemplateDialog show onClose={onClose} />}
    </>
  )
}
