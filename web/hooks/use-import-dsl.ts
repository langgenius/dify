import type {
  DSLImportMode,
  DSLImportResponse,
} from '@/models/app'
import type { AppIconType } from '@/types/app'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useToastContext } from '@/app/components/base/toast'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useSelector } from '@/context/app-context'
import { DSLImportStatus } from '@/models/app'
import {
  importDSL,
  importDSLConfirm,
} from '@/service/apps'
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
  onSuccess?: () => void
  onPending?: (payload: DSLImportResponse) => void
  onFailed?: () => void
}
export const useImportDSL = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [isFetching, setIsFetching] = useState(false)
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const isCurrentWorkspaceEditor = useSelector(s => s.isCurrentWorkspaceEditor)
  const { push } = useRouter()
  const [versions, setVersions] = useState<{ importedVersion: string, systemVersion: string }>()
  const importIdRef = useRef<string>('')

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
      } = response

      if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
        if (!app_id)
          return

        notify({
          type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
          message: t(status === DSLImportStatus.COMPLETED ? 'newApp.appCreated' : 'newApp.caution', { ns: 'app' }),
          children: status === DSLImportStatus.COMPLETED_WITH_WARNINGS && t('newApp.appCreateDSLWarning', { ns: 'app' }),
        })
        onSuccess?.()
        localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
        await handleCheckPluginDependencies(app_id)
        getRedirection(isCurrentWorkspaceEditor, { id: app_id, mode: app_mode }, push)
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
        notify({ type: 'error', message: t('newApp.appCreateFailed', { ns: 'app' }) })
        onFailed?.()
      }
    }
    catch {
      notify({ type: 'error', message: t('newApp.appCreateFailed', { ns: 'app' }) })
      onFailed?.()
    }
    finally {
      setIsFetching(false)
    }
  }, [t, notify, handleCheckPluginDependencies, isCurrentWorkspaceEditor, push, isFetching])

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

      const { status, app_id, app_mode } = response
      if (!app_id)
        return

      if (status === DSLImportStatus.COMPLETED) {
        onSuccess?.()
        notify({
          type: 'success',
          message: t('newApp.appCreated', { ns: 'app' }),
        })
        await handleCheckPluginDependencies(app_id)
        localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
        getRedirection(isCurrentWorkspaceEditor, { id: app_id!, mode: app_mode }, push)
      }
      else if (status === DSLImportStatus.FAILED) {
        notify({ type: 'error', message: t('newApp.appCreateFailed', { ns: 'app' }) })
        onFailed?.()
      }
    }
    catch {
      notify({ type: 'error', message: t('newApp.appCreateFailed', { ns: 'app' }) })
      onFailed?.()
    }
    finally {
      setIsFetching(false)
    }
  }, [t, notify, handleCheckPluginDependencies, isCurrentWorkspaceEditor, push, isFetching])

  return {
    handleImportDSL,
    handleImportDSLConfirm,
    versions,
    isFetching,
  }
}
