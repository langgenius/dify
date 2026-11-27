'use client'

import type { AppListUrlQuery } from './query-params'
import type { BuilderCreationMode } from '@/features/dify-builder/creation/pending-prompt'
import { zPostAppsBody } from '@dify/contracts/api/console/apps/zod.gen'
import dynamic from 'next/dynamic'

type AppListCategory = AppListUrlQuery['category']

const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), {
  ssr: false,
})
const CreateAppModal = dynamic(() => import('@/app/components/app/create-app-modal'), {
  ssr: false,
})
const CreateAppTemplateDialog = dynamic(() => import('@/app/components/app/create-app-dialog'), {
  ssr: false,
})

const BuilderCreationPromptDialog = dynamic(
  () => import('@/features/dify-builder/creation/prompt-dialog'),
  { ssr: false },
)

export type AppListCreationDialog =
  | { type: 'builder'; mode: BuilderCreationMode }
  | { type: 'blank' }
  | { type: 'template' }
  | { type: 'dsl'; droppedFile?: File }
  | null

export function AppListCreationModals({
  canCreateApp,
  defaultMode,
  dialog,
  onClose,
  onOpenBlank,
  onOpenTemplate,
}: {
  canCreateApp: boolean
  /** Preselected app type for blank creation; `all` leaves the picker on its default. */
  defaultMode: AppListCategory
  dialog: AppListCreationDialog
  onClose: () => void
  onOpenBlank: () => void
  onOpenTemplate: () => void
}) {
  if (!canCreateApp) return null
  const defaultAppModeResult = zPostAppsBody.shape.mode.safeParse(defaultMode)

  return (
    <>
      {dialog?.type === 'builder' && (
        <BuilderCreationPromptDialog mode={dialog.mode} onClose={onClose} />
      )}
      {dialog?.type === 'dsl' && (
        <CreateFromDSLModal show onClose={onClose} droppedFile={dialog.droppedFile} />
      )}
      {dialog?.type === 'blank' && (
        <CreateAppModal
          show
          onClose={onClose}
          onCreateFromTemplate={onOpenTemplate}
          defaultAppMode={defaultAppModeResult.success ? defaultAppModeResult.data : undefined}
        />
      )}
      {dialog?.type === 'template' && (
        <CreateAppTemplateDialog show onClose={onClose} onCreateFromBlank={onOpenBlank} />
      )}
    </>
  )
}
