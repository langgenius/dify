'use client'

import { useAtomValue } from 'jotai'
import dynamic from 'next/dynamic'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useState } from 'react'
import CreateAppModal from '@/app/components/app/create-app-modal'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useRouter } from '@/next/navigation'
import { hasPermission } from '@/utils/permission'
import { createAppModeQueryParser } from './query-params'

const CreateAppTemplateDialog = dynamic(() => import('@/app/components/app/create-app-dialog'), {
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
  const [showsTemplates, setShowsTemplates] = useState(false)

  const leave = useCallback(() => replace('/apps'), [replace])

  useEffect(() => {
    if (!canCreateApp) replace('/apps')
  }, [canCreateApp, replace])

  if (!canCreateApp) return null

  if (showsTemplates) {
    return (
      <CreateAppTemplateDialog
        show
        onClose={leave}
        onCreateFromBlank={() => setShowsTemplates(false)}
      />
    )
  }

  return (
    <CreateAppModal
      inline
      show
      onClose={leave}
      onCreateFromTemplate={() => setShowsTemplates(true)}
      defaultAppMode={mode ?? undefined}
    />
  )
}
