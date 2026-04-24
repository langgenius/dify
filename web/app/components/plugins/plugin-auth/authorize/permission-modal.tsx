import type { PluginPayload } from '../types'
import type { Member } from '@/models/common'
import {
  memo,
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
// eslint-disable-next-line no-restricted-imports -- legacy modal, migration tracked in #32767
import Modal from '@/app/components/base/modal/modal'
import PermissionSelector from '@/app/components/base/permission-selector'
// eslint-disable-next-line no-restricted-imports -- legacy toast, migration tracked in #32811
import { useToastContext } from '@/app/components/base/toast/context'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { PermissionLevel } from '@/models/permission'
import { useMembers } from '@/service/use-common'
import { useUpdatePluginCredentialHook } from '../hooks/use-credential'

export type PermissionModalProps = {
  pluginPayload: PluginPayload
  credentialId: string
  credentialName: string
  createdBy?: string
  initialVisibility?: string
  initialPartialMemberList?: string[]
  onClose?: () => void
  onUpdate?: () => void
  disabled?: boolean
}

const PermissionModal = ({
  pluginPayload,
  credentialId,
  credentialName,
  createdBy,
  initialVisibility,
  initialPartialMemberList,
  onClose,
  onUpdate,
  disabled,
}: PermissionModalProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const handleSetDoingAction = useCallback((value: boolean) => {
    doingActionRef.current = value
    setDoingAction(value)
  }, [])

  const [permission, setPermission] = useState<PermissionLevel | undefined>(
    (initialVisibility as PermissionLevel) ?? PermissionLevel.allTeamMembers,
  )
  const [selectedMemberIDs, setSelectedMemberIDs] = useState<string[]>(
    initialPartialMemberList ?? [],
  )
  const { data: membersData } = useMembers()
  const memberList: Member[] = membersData?.accounts ?? []
  const userProfile = useAppContextWithSelector(state => state.userProfile)
  const isCreator = !createdBy || createdBy === userProfile.id

  const { mutateAsync: updatePluginCredential } = useUpdatePluginCredentialHook(pluginPayload)

  const handleConfirm = useCallback(async () => {
    if (doingActionRef.current)
      return
    if (!isCreator) {
      notify({ type: 'error', message: 'Only the credential creator can change permissions.' })
      return
    }
    try {
      handleSetDoingAction(true)
      const permissionPayload: Record<string, unknown> = {
        visibility: permission,
      }
      if (permission === PermissionLevel.partialMembers)
        permissionPayload.partial_member_list = selectedMemberIDs.map(id => ({ user_id: id }))

      await updatePluginCredential({
        credential_id: credentialId,
        ...permissionPayload,
      })
      notify({
        type: 'success',
        message: t('api.actionSuccess', { ns: 'common' }),
      })
      onClose?.()
      onUpdate?.()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [isCreator, permission, selectedMemberIDs, updatePluginCredential, credentialId, notify, t, onClose, onUpdate, handleSetDoingAction])

  return (
    <Modal
      size="md"
      title="Manage Permissions"
      subTitle={`Who can use the credential "${credentialName}"`}
      onClose={onClose}
      onCancel={onClose}
      onConfirm={handleConfirm}
      disabled={disabled || doingAction || !isCreator}
      clickOutsideNotClose={true}
      wrapperClassName="!z-[101]"
    >
      <div className="px-1">
        <div className="mb-1 system-sm-semibold text-text-secondary">
          {t('form.permissions', { ns: 'datasetSettings' })}
        </div>
        <PermissionSelector
          disabled={disabled || !isCreator}
          permission={permission}
          value={selectedMemberIDs}
          memberList={memberList}
          onChange={v => setPermission(v)}
          onMemberSelect={setSelectedMemberIDs}
        />
        {!isCreator && (
          <div className="mt-2 system-xs-regular text-text-tertiary">
            Only the credential creator can change permissions.
          </div>
        )}
      </div>
    </Modal>
  )
}

export default memo(PermissionModal)
