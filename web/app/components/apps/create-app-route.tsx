'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import dynamic from 'next/dynamic'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect } from 'react'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useRouter } from '@/next/navigation'
import { hasPermission } from '@/utils/permission'
import { templateDialogRequestedAtom } from './creation-requests'
import { createAppModeQueryParser } from './query-params'

const CreateAppModal = dynamic(() => import('@/app/components/app/create-app-modal'), {
  ssr: false,
})

/**
 * Blank app creation visited directly at `/apps/create?mode=<app type>`, without
 * the Studio list. Inside the Studio the list opens it with a shallow URL instead.
 */
export function CreateAppRoute() {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const [mode] = useQueryState('mode', createAppModeQueryParser)
  const { replace } = useRouter()
  const requestTemplateDialog = useSetAtom(templateDialogRequestedAtom)

  const leave = useCallback(() => replace('/apps'), [replace])

  useEffect(() => {
    if (!canCreateApp) replace('/apps')
  }, [canCreateApp, replace])

  if (!canCreateApp) return null

  return (
    <CreateAppModal
      show
      onClose={leave}
      onCreateFromTemplate={() => {
        requestTemplateDialog(true)
        leave()
      }}
      defaultAppMode={mode ?? undefined}
    />
  )
}
