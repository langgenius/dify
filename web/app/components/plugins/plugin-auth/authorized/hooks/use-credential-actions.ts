import type { MutableRefObject } from 'react'
import type { PluginPayload } from '../../types'
import {
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useToastContext } from '@/app/components/base/toast'
import {
  useDeletePluginCredentialHook,
  useSetPluginDefaultCredentialHook,
  useUpdatePluginCredentialHook,
} from '../../hooks/use-credential'

type UseCredentialActionsOptions = {
  pluginPayload: PluginPayload
  onUpdate?: () => void
}

type UseCredentialActionsReturn = {
  doingAction: boolean
  doingActionRef: MutableRefObject<boolean>
  pendingOperationCredentialIdRef: MutableRefObject<string | null>
  handleSetDoingAction: (doing: boolean) => void
  handleDelete: (credentialId: string) => Promise<void>
  handleSetDefault: (id: string) => Promise<void>
  handleRename: (payload: { credential_id: string, name: string }) => Promise<void>
}

/**
 * Custom hook for credential CRUD operations
 * Consolidates delete, setDefault, rename actions with shared loading state
 */
export const useCredentialActions = ({
  pluginPayload,
  onUpdate,
}: UseCredentialActionsOptions): UseCredentialActionsReturn => {
  const { t } = useTranslation()
  const { notify } = useToastContext()

  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const pendingOperationCredentialIdRef = useRef<string | null>(null)

  const handleSetDoingAction = useCallback((doing: boolean) => {
    doingActionRef.current = doing
    setDoingAction(doing)
  }, [])

  const { mutateAsync: deletePluginCredential } = useDeletePluginCredentialHook(pluginPayload)
  const { mutateAsync: setPluginDefaultCredential } = useSetPluginDefaultCredentialHook(pluginPayload)
  const { mutateAsync: updatePluginCredential } = useUpdatePluginCredentialHook(pluginPayload)

  const showSuccessNotification = useCallback(() => {
    notify({
      type: 'success',
      message: t('api.actionSuccess', { ns: 'common' }),
    })
  }, [notify, t])

  const handleDelete = useCallback(async (credentialId: string) => {
    if (doingActionRef.current)
      return
    try {
      handleSetDoingAction(true)
      await deletePluginCredential({ credential_id: credentialId })
      showSuccessNotification()
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [deletePluginCredential, onUpdate, showSuccessNotification, handleSetDoingAction])

  const handleSetDefault = useCallback(async (id: string) => {
    if (doingActionRef.current)
      return
    try {
      handleSetDoingAction(true)
      await setPluginDefaultCredential(id)
      showSuccessNotification()
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [setPluginDefaultCredential, onUpdate, showSuccessNotification, handleSetDoingAction])

  const handleRename = useCallback(async (payload: {
    credential_id: string
    name: string
  }) => {
    if (doingActionRef.current)
      return
    try {
      handleSetDoingAction(true)
      await updatePluginCredential(payload)
      showSuccessNotification()
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [updatePluginCredential, showSuccessNotification, handleSetDoingAction, onUpdate])

  return {
    doingAction,
    doingActionRef,
    pendingOperationCredentialIdRef,
    handleSetDoingAction,
    handleDelete,
    handleSetDefault,
    handleRename,
  }
}
