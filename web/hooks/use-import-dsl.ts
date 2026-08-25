import type { AppImportPayload, Import } from '@dify/contracts/api/console/apps/types.gen'
import type { AppIconType } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { DSLImportStatus } from '@/models/app'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { getRedirection } from '@/utils/app-redirection'
import { resolveImportedAppRedirectionTarget } from '@/utils/imported-app-redirection'

type DSLPayload = Omit<AppImportPayload, 'icon_type'> & {
  icon_type?: AppIconType
}
type ResponseCallback = {
  onSuccess?: (payload: Import) => void
  onPending?: (payload: Import) => void
  onFailed?: () => void
  skipRedirectOnSuccess?: boolean
}
export const useImportDSL = () => {
  const { t } = useTranslation()
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const { push } = useRouter()
  const { mutateAsync: importApp } = useMutation(consoleQuery.apps.imports.post.mutationOptions())
  const { mutateAsync: confirmImport } = useMutation(
    consoleQuery.apps.imports.byImportId.confirm.post.mutationOptions(),
  )
  const actionInFlightRef = useRef(false)
  const [isFetching, setIsFetching] = useState(false)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isRbacEnabled = systemFeatures.rbac_enabled
  const [versions, setVersions] = useState<{ importedVersion: string; systemVersion: string }>()
  const importIdRef = useRef<string>('')

  const handleImportDSL = useCallback(
    async (
      payload: DSLPayload,
      { onSuccess, onPending, onFailed, skipRedirectOnSuccess }: ResponseCallback,
    ) => {
      if (actionInFlightRef.current) return
      actionInFlightRef.current = true
      setIsFetching(true)

      try {
        const response = await importApp({ body: payload })

        if (!response) return

        const {
          id,
          status,
          app_id,
          app_mode,
          imported_dsl_version,
          current_dsl_version,
          permission_keys,
        } = response

        if (
          status === DSLImportStatus.COMPLETED ||
          status === DSLImportStatus.COMPLETED_WITH_WARNINGS
        ) {
          if (!app_id || !app_mode) throw new Error('Completed import is missing app metadata')

          const message = t(
            ($) => $[status === DSLImportStatus.COMPLETED ? 'newApp.appCreated' : 'newApp.caution'],
            { ns: 'app' },
          )
          const description =
            status === DSLImportStatus.COMPLETED_WITH_WARNINGS
              ? t(($) => $['newApp.appCreateDSLWarning'], { ns: 'app' })
              : undefined

          if (status === DSLImportStatus.COMPLETED) toast.success(message)
          else toast.warning(message, { description })
          onSuccess?.(response)
          await handleCheckPluginDependencies(app_id)
          if (!skipRedirectOnSuccess) {
            const redirectionTarget = await resolveImportedAppRedirectionTarget({
              id: app_id,
              mode: app_mode,
              permission_keys,
            })
            getRedirection(redirectionTarget, push, {
              currentUserId,
              resourceMaintainer: currentUserId,
              workspacePermissionKeys,
              isRbacEnabled,
            })
          }
        } else if (status === DSLImportStatus.PENDING) {
          setVersions({
            importedVersion: imported_dsl_version ?? '',
            systemVersion: current_dsl_version ?? '',
          })
          importIdRef.current = id
          onPending?.(response)
        } else {
          toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
          onFailed?.()
        }
      } catch {
        toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
        onFailed?.()
      } finally {
        actionInFlightRef.current = false
        setIsFetching(false)
      }
    },
    [
      t,
      handleCheckPluginDependencies,
      isRbacEnabled,
      push,
      importApp,
      currentUserId,
      workspacePermissionKeys,
    ],
  )

  const handleImportDSLConfirm = useCallback(
    async ({
      onSuccess,
      onFailed,
      skipRedirectOnSuccess,
    }: Pick<ResponseCallback, 'onSuccess' | 'onFailed' | 'skipRedirectOnSuccess'>) => {
      if (!importIdRef.current) return
      if (actionInFlightRef.current) return
      actionInFlightRef.current = true
      setIsFetching(true)

      try {
        const response = await confirmImport({
          params: { import_id: importIdRef.current },
        })

        const { status, app_id, app_mode, permission_keys } = response
        if (!app_id) return

        if (
          status === DSLImportStatus.COMPLETED ||
          status === DSLImportStatus.COMPLETED_WITH_WARNINGS
        ) {
          if (!app_id || !app_mode) throw new Error('Completed import is missing app metadata')

          onSuccess?.(response)
          const message = t(
            ($) => $[status === DSLImportStatus.COMPLETED ? 'newApp.appCreated' : 'newApp.caution'],
            { ns: 'app' },
          )
          const description =
            status === DSLImportStatus.COMPLETED_WITH_WARNINGS
              ? t(($) => $['newApp.appCreateDSLWarning'], { ns: 'app' })
              : undefined

          if (status === DSLImportStatus.COMPLETED) toast.success(message)
          else toast.warning(message, { description })
          await handleCheckPluginDependencies(app_id)
          if (!skipRedirectOnSuccess) {
            const redirectionTarget = await resolveImportedAppRedirectionTarget({
              id: app_id,
              mode: app_mode,
              permission_keys,
            })
            getRedirection(redirectionTarget, push, {
              currentUserId,
              resourceMaintainer: currentUserId,
              workspacePermissionKeys,
              isRbacEnabled,
            })
          }
        } else if (status === DSLImportStatus.FAILED) {
          toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
          onFailed?.()
        }
      } catch {
        toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
        onFailed?.()
      } finally {
        actionInFlightRef.current = false
        setIsFetching(false)
      }
    },
    [
      t,
      handleCheckPluginDependencies,
      isRbacEnabled,
      push,
      confirmImport,
      currentUserId,
      workspacePermissionKeys,
    ],
  )

  return {
    handleImportDSL,
    handleImportDSLConfirm,
    versions,
    isFetching,
  }
}
