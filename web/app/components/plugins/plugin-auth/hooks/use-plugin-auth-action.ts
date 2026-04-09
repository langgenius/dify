import type { PluginPayload } from '../types'
import {
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
import {
  useDeletePluginCredentialHook,
  useSetPluginDefaultCredentialHook,
  useUpdatePluginCredentialHook,
} from '../hooks/use-credential'

export const usePluginAuthAction = (
  pluginPayload: PluginPayload,
  onUpdate?: () => void,
) => {
  const { t } = useTranslation()
  const pendingOperationCredentialId = useRef<string | null>(null)
  const [deleteCredentialId, setDeleteCredentialId] = useState<string | null>(null)
  const { mutateAsync: deletePluginCredential } = useDeletePluginCredentialHook(pluginPayload)
  const openConfirm = useCallback((credentialId?: string) => {
    if (credentialId)
      pendingOperationCredentialId.current = credentialId

    setDeleteCredentialId(pendingOperationCredentialId.current)
  }, [])
  const closeConfirm = useCallback(() => {
    setDeleteCredentialId(null)
    pendingOperationCredentialId.current = null
  }, [])
  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const handleSetDoingAction = useCallback((doing: boolean) => {
    doingActionRef.current = doing
    setDoingAction(doing)
  }, [])
  const [editValues, setEditValues] = useState<Record<string, unknown> | null>(null)
  const handleConfirm = useCallback(async () => {
    if (doingActionRef.current)
      return
    if (!pendingOperationCredentialId.current) {
      setDeleteCredentialId(null)
      return
    }
    try {
      handleSetDoingAction(true)
      await deletePluginCredential({ credential_id: pendingOperationCredentialId.current })
      toast.success(t('api.actionSuccess', { ns: 'common' }))
      onUpdate?.()
      setDeleteCredentialId(null)
      pendingOperationCredentialId.current = null
      setEditValues(null)
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [deletePluginCredential, onUpdate, t, handleSetDoingAction])
  const handleEdit = useCallback((id: string, values: Record<string, unknown>) => {
    pendingOperationCredentialId.current = id
    setEditValues(values)
  }, [])
  const handleRemove = useCallback(() => {
    setDeleteCredentialId(pendingOperationCredentialId.current)
  }, [])
  const { mutateAsync: setPluginDefaultCredential } = useSetPluginDefaultCredentialHook(pluginPayload)
  const handleSetDefault = useCallback(async (id: string) => {
    if (doingActionRef.current)
      return
    try {
      handleSetDoingAction(true)
      await setPluginDefaultCredential(id)
      toast.success(t('api.actionSuccess', { ns: 'common' }))
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [setPluginDefaultCredential, onUpdate, t, handleSetDoingAction])
  const { mutateAsync: updatePluginCredential } = useUpdatePluginCredentialHook(pluginPayload)
  const handleRename = useCallback(async (payload: {
    credential_id: string
    name: string
  }) => {
    if (doingActionRef.current)
      return
    try {
      handleSetDoingAction(true)
      await updatePluginCredential(payload)
      toast.success(t('api.actionSuccess', { ns: 'common' }))
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [updatePluginCredential, t, handleSetDoingAction, onUpdate])

  return {
    doingAction,
    handleSetDoingAction,
    openConfirm,
    closeConfirm,
    deleteCredentialId,
    setDeleteCredentialId,
    handleConfirm,
    editValues,
    setEditValues,
    handleEdit,
    handleRemove,
    handleSetDefault,
    handleRename,
    pendingOperationCredentialId,
  }
}
