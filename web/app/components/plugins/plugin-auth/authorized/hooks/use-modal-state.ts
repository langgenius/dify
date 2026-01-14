import type { MutableRefObject } from 'react'
import {
  useCallback,
  useState,
} from 'react'

type CredentialValues = Record<string, unknown>

type UseModalStateOptions = {
  pendingOperationCredentialIdRef: MutableRefObject<string | null>
}

type UseModalStateReturn = {
  // Delete modal state
  deleteCredentialId: string | null
  openDeleteConfirm: (credentialId?: string) => void
  closeDeleteConfirm: () => void
  // Edit modal state
  editValues: CredentialValues | null
  openEditModal: (id: string, values: CredentialValues) => void
  closeEditModal: () => void
  // Remove action (used from edit modal)
  handleRemoveFromEdit: () => void
}

/**
 * Custom hook for managing modal states
 * Handles delete confirmation and edit modal with shared pending credential tracking
 */
export const useModalState = ({
  pendingOperationCredentialIdRef,
}: UseModalStateOptions): UseModalStateReturn => {
  const [deleteCredentialId, setDeleteCredentialId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<CredentialValues | null>(null)

  const openDeleteConfirm = useCallback((credentialId?: string) => {
    if (credentialId)
      pendingOperationCredentialIdRef.current = credentialId

    setDeleteCredentialId(pendingOperationCredentialIdRef.current)
  }, [pendingOperationCredentialIdRef])

  const closeDeleteConfirm = useCallback(() => {
    setDeleteCredentialId(null)
    pendingOperationCredentialIdRef.current = null
  }, [pendingOperationCredentialIdRef])

  const openEditModal = useCallback((id: string, values: CredentialValues) => {
    pendingOperationCredentialIdRef.current = id
    setEditValues(values)
  }, [pendingOperationCredentialIdRef])

  const closeEditModal = useCallback(() => {
    setEditValues(null)
    pendingOperationCredentialIdRef.current = null
  }, [pendingOperationCredentialIdRef])

  const handleRemoveFromEdit = useCallback(() => {
    setDeleteCredentialId(pendingOperationCredentialIdRef.current)
  }, [pendingOperationCredentialIdRef])

  return {
    deleteCredentialId,
    openDeleteConfirm,
    closeDeleteConfirm,
    editValues,
    openEditModal,
    closeEditModal,
    handleRemoveFromEdit,
  }
}
