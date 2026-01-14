import type { PluginPayload } from '../types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import ApiKeyModal from '../authorize/api-key-modal'

type AuthorizedModalsProps = {
  pluginPayload: PluginPayload
  // Delete confirmation
  deleteCredentialId: string | null
  doingAction: boolean
  onDeleteConfirm: () => void
  onDeleteCancel: () => void
  // Edit modal
  editValues: Record<string, unknown> | null
  disabled?: boolean
  onEditClose: () => void
  onRemove: () => void
  onUpdate?: () => void
}

/**
 * Component for managing authorized modals (delete confirmation and edit modal)
 * Extracted to reduce complexity in the main Authorized component
 */
const AuthorizedModals = ({
  pluginPayload,
  deleteCredentialId,
  doingAction,
  onDeleteConfirm,
  onDeleteCancel,
  editValues,
  disabled,
  onEditClose,
  onRemove,
  onUpdate,
}: AuthorizedModalsProps) => {
  const { t } = useTranslation()

  return (
    <>
      {deleteCredentialId && (
        <Confirm
          isShow
          title={t('list.delete.title', { ns: 'datasetDocuments' })}
          isDisabled={doingAction}
          onCancel={onDeleteCancel}
          onConfirm={onDeleteConfirm}
        />
      )}
      {!!editValues && (
        <ApiKeyModal
          pluginPayload={pluginPayload}
          editValues={editValues}
          onClose={onEditClose}
          onRemove={onRemove}
          disabled={disabled || doingAction}
          onUpdate={onUpdate}
        />
      )}
    </>
  )
}

export default memo(AuthorizedModals)
