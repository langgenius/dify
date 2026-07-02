import type { DataSourceCredential } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import PermissionSelector from '@/app/components/base/permission-selector'
import { PermissionLevel } from '@/models/permission'
import { useMembers } from '@/service/use-common'
import { useUpdateDataSourceCredentialVisibility } from '@/service/use-datasource'

type VisibilityModalProps = {
  // `${pluginId}/${name}`, matching the other datasource auth endpoints
  provider: string
  credentialItem: DataSourceCredential
  onClose: () => void
  onUpdate?: () => void
  disabled?: boolean
}
const VisibilityModal = ({
  provider,
  credentialItem,
  onClose,
  onUpdate,
  disabled,
}: VisibilityModalProps) => {
  const { t } = useTranslation()
  const [doingAction, setDoingAction] = useState(false)
  const [permission, setPermission] = useState<PermissionLevel | undefined>(
    (credentialItem.visibility as PermissionLevel) ?? PermissionLevel.allTeamMembers,
  )
  const [selectedMemberIDs, setSelectedMemberIDs] = useState<string[]>(
    credentialItem.partial_member_list ?? [],
  )
  const { data: membersData } = useMembers()
  const memberList = membersData?.accounts ?? []
  const { mutateAsync: updateVisibility } = useUpdateDataSourceCredentialVisibility(provider)

  // partial_members requires at least one member; the backend rejects an empty list.
  const isPartialMembersEmpty = permission === PermissionLevel.partialMembers && selectedMemberIDs.length === 0

  const handleConfirm = useCallback(async () => {
    if (doingAction || !permission || isPartialMembersEmpty)
      return
    try {
      setDoingAction(true)
      await updateVisibility({
        credential_id: credentialItem.id,
        visibility: permission,
        ...(permission === PermissionLevel.partialMembers
          ? { partial_member_list: selectedMemberIDs }
          : {}),
      })
      toast.success(t('api.actionSuccess', { ns: 'common' }))
      onUpdate?.()
      onClose()
    }
    finally {
      setDoingAction(false)
    }
  }, [doingAction, permission, isPartialMembersEmpty, selectedMemberIDs, updateVisibility, credentialItem.id, onUpdate, onClose, t])

  const isDisabled = disabled || doingAction
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen)
      onClose()
  }, [onClose])

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="w-[480px]! max-w-[calc(100vw-2rem)]! p-0!"
      >
        <div className="flex flex-col">
          <div className="relative shrink-0 p-6 pr-14 pb-3">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t('auth.whoCanUse', { ns: 'plugin' })}
            </DialogTitle>
            <DialogCloseButton className="top-5 right-5 size-8 rounded-lg" />
          </div>
          <div className="px-6 py-3">
            <PermissionSelector
              disabled={isDisabled}
              permission={permission}
              value={selectedMemberIDs}
              memberList={memberList}
              onChange={v => setPermission(v)}
              onMemberSelect={setSelectedMemberIDs}
            />
          </div>
          <div className="flex shrink-0 justify-end p-6 pt-5">
            <Button
              onClick={() => handleOpenChange(false)}
              disabled={isDisabled}
            >
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button
              className="ml-2"
              variant="primary"
              onClick={handleConfirm}
              disabled={isDisabled || isPartialMembersEmpty}
            >
              {t('operation.save', { ns: 'common' })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default memo(VisibilityModal)
