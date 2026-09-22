'use client'

import type { AppListUrlQuery } from './query-params'
import { zPostAppsBody } from '@dify/contracts/api/console/apps/zod.gen'
import dynamic from '@/next/dynamic'

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

export type AppListCreationDialog =
  | { type: 'blank' }
  | { type: 'template' }
  | { type: 'dsl'; droppedFile?: File }
  | null

export function AppListCreationModals({
  canCreateApp,
  category,
  dialog,
  onClose,
  onOpenBlank,
  onOpenTemplate,
}: {
  canCreateApp: boolean
  category: AppListCategory
  dialog: AppListCreationDialog
  onClose: () => void
  onOpenBlank: () => void
  onOpenTemplate: () => void
}) {
  if (!canCreateApp) return null
  const defaultAppModeResult = zPostAppsBody.shape.mode.safeParse(category)

  return (
    <>
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
