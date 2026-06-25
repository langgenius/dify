import type {
  DSLImportMode,
  DSLImportResponse,
} from '@/models/app'
import type { AppIconType } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useSetNeedRefreshAppList } from '@/app/components/apps/storage'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { DSLImportStatus } from '@/models/app'
import { useRouter } from '@/next/navigation'
import {
  importDSL,
  importDSLConfirm,
} from '@/service/apps'
import { useInvalidateAppList } from '@/service/use-apps'
import { getRedirection } from '@/utils/app-redirection'

type DSLPayload = {
  mode: DSLImportMode
  yaml_content?: string
  yaml_url?: string
  name?: string
  icon_type?: AppIconType
  icon?: string
  icon_background?: string
  description?: string
}
type ResponseCallback = {
  onSuccess?: (payload: DSLImportResponse) => void
  onPending?: (payload: DSLImportResponse) => void
  onFailed?: () => void
}
export const useImportDSL = () => {
  const { t } = useTranslation()
  const [isFetching, setIsFetching] = useState(false)
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const { push } = useRouter()
  const invalidateAppList = useInvalidateAppList()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isRbacEnabled = systemFeatures.rbac_enabled
  const [versions, setVersions] = useState<{ importedVersion: string, systemVersion: string }>()
  const importIdRef = useRef<string>('')
  const setNeedRefresh = useSetNeedRefreshAppList()

  const handleImportDSL = useCallback(async (
    payload: DSLPayload,
    {
      onSuccess,
      onPending,
      onFailed,
    }: ResponseCallback,
  ) => {
    if (isFetching)
      return
    setIsFetching(true)

    try {
      const response = await importDSL(payload)

      if (!response)
        return

      const {
        id,
        status,
        app_id,
        app_mode,
        imported_dsl_version,
        current_dsl_version,
        permission_keys,
      } = response

      if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
        if (!app_id)
          return

        const message = t(status === DSLImportStatus.COMPLETED ? 'newApp.appCreated' : 'newApp.caution', { ns: 'app' })
        const description = status === DSLImportStatus.COMPLETED_WITH_WARNINGS
          ? t('newApp.appCreateDSLWarning', { ns: 'app' })
          : undefined

        if (status === DSLImportStatus.COMPLETED)
          toast.success(message)
        else
          toast.warning(message, { description })
        onSuccess?.(response)
        setNeedRefresh('1')
        invalidateAppList()
        await handleCheckPluginDependencies(app_id)
        getRedirection({ id: app_id, mode: app_mode, permission_keys }, push, { isRbacEnabled })
      }
      else if (status === DSLImportStatus.PENDING) {
        setVersions({
          importedVersion: imported_dsl_version ?? '',
          systemVersion: current_dsl_version ?? '',
        })
        importIdRef.current = id
        onPending?.(response)
      }
      else {
        toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
        onFailed?.()
      }
    }
    catch {
      toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
      onFailed?.()
    }
    finally {
      setIsFetching(false)
    }
  }, [isFetching, t, handleCheckPluginDependencies, isRbacEnabled, push, setNeedRefresh, invalidateAppList])

  const handleImportDSLConfirm = useCallback(async (
    {
      onSuccess,
      onFailed,
    }: Pick<ResponseCallback, 'onSuccess' | 'onFailed'>,
  ) => {
    if (isFetching)
      return
    setIsFetching(true)
    if (!importIdRef.current)
      return

    try {
      const response = await importDSLConfirm({
        import_id: importIdRef.current,
      })

      const { status, app_id, app_mode, permission_keys } = response
      if (!app_id)
        return

      if (status === DSLImportStatus.COMPLETED) {
        onSuccess?.(response)
        toast.success(t('newApp.appCreated', { ns: 'app' }))
        await handleCheckPluginDependencies(app_id)
        setNeedRefresh('1')
        invalidateAppList()
        getRedirection({ id: app_id, mode: app_mode, permission_keys }, push, { isRbacEnabled })
      }
      else if (status === DSLImportStatus.FAILED) {
        toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
        onFailed?.()
      }
    }
    catch {
      toast.error(t('newApp.appCreateFailed', { ns: 'app' }))
      onFailed?.()
    }
    finally {
      setIsFetching(false)
    }
  }, [isFetching, t, handleCheckPluginDependencies, isRbacEnabled, setNeedRefresh, push, invalidateAppList])

  return {
    handleImportDSL,
    handleImportDSLConfirm,
    versions,
    isFetching,
  }
}
