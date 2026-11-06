'use client'

import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useEffect } from 'react'
import CreateAppTemplateDialog from '@/app/components/app/create-app-dialog'
import CreateAppModal from '@/app/components/app/create-app-modal'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useRouter } from '@/next/navigation'
import { hasPermission } from '@/utils/permission'
import { createAppModeQueryParser, createAppPath, createAppTemplatePath } from './query-params'

// Visited directly, the creation routes render their dialog on its own, without the
// Studio list. Inside the Studio the list opens the same dialogs with shallow URLs.

function useCreationRoute() {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const { replace } = useRouter()

  useEffect(() => {
    if (!canCreateApp) replace('/apps')
  }, [canCreateApp, replace])

  return { canCreateApp, replace }
}

// Stay open until the new app replaces the page.
const keepOpenAfterCreating = () => {}

/** `/apps/create?mode=<app type>`: blank app creation. */
export function CreateAppRoute() {
  const { canCreateApp, replace } = useCreationRoute()
  const [mode] = useQueryState('mode', createAppModeQueryParser)
  if (!canCreateApp) return null

  return (
    <CreateAppModal
      inline
      show
      onClose={() => replace('/apps')}
      onCreateFromTemplate={() => replace(createAppTemplatePath)}
      defaultAppMode={mode ?? undefined}
    />
  )
}

/** `/apps/create/template`: app creation from a template. */
export function CreateAppTemplateRoute() {
  const { canCreateApp, replace } = useCreationRoute()
  if (!canCreateApp) return null

  return (
    <CreateAppTemplateDialog
      inline
      show
      onClose={() => replace('/apps')}
      onCreated={keepOpenAfterCreating}
      onCreateFromBlank={() => replace(createAppPath)}
    />
  )
}
