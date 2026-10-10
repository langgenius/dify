'use client'

import type { AppListUrlQuery } from './query-params'
import { zPostAppsBody } from '@dify/contracts/api/console/apps/zod.gen'
import dynamic from 'next/dynamic'
import { useState } from 'react'

type AppListCategory = AppListUrlQuery['category']

const CreateFromDSLModal = dynamic(
  () =>
    import('@/app/components/app/create-from-dsl-modal').then(
      (module) => module.CreateFromDSLModal,
    ),
  { ssr: false },
)
const CreateAppModal = dynamic(
  () => import('@/app/components/app/create-app-modal').then((module) => module.CreateAppModal),
  { ssr: false },
)
const CreateAppTemplateDialog = dynamic(
  () =>
    import('@/app/components/app/create-app-dialog').then(
      (module) => module.CreateAppTemplateDialog,
    ),
  { ssr: false },
)

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
  const [hasActivatedBlank, setHasActivatedBlank] = useState(() => dialog?.type === 'blank')
  const [hasActivatedTemplate, setHasActivatedTemplate] = useState(
    () => dialog?.type === 'template',
  )
  const [hasActivatedImport, setHasActivatedImport] = useState(() => dialog?.type === 'dsl')
  if (dialog?.type === 'blank' && !hasActivatedBlank) setHasActivatedBlank(true)
  if (dialog?.type === 'template' && !hasActivatedTemplate) setHasActivatedTemplate(true)
  if (dialog?.type === 'dsl' && !hasActivatedImport) setHasActivatedImport(true)

  if (!canCreateApp) return null
  const defaultAppModeResult = zPostAppsBody.shape.mode.safeParse(category)
  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  return (
    <>
      {hasActivatedImport && (
        <CreateFromDSLModal
          open={dialog?.type === 'dsl'}
          onOpenChange={handleOpenChange}
          droppedFile={dialog?.type === 'dsl' ? dialog.droppedFile : undefined}
        />
      )}
      {hasActivatedBlank && (
        <CreateAppModal
          open={dialog?.type === 'blank'}
          onOpenChange={handleOpenChange}
          onCreateFromTemplate={onOpenTemplate}
          defaultAppMode={defaultAppModeResult.success ? defaultAppModeResult.data : undefined}
        />
      )}
      {hasActivatedTemplate && (
        <CreateAppTemplateDialog
          open={dialog?.type === 'template'}
          onOpenChange={handleOpenChange}
          onCreateFromBlank={onOpenBlank}
        />
      )}
    </>
  )
}
