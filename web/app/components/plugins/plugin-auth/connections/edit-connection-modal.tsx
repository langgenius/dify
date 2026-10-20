import type { Credential } from '../types'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { PermissionLevel } from '@/models/permission'
import ConnectionDetailsForm from './connection-details-form'

export type EditConnectionDataSource = {
  canEdit: boolean
  canUse: boolean
  resetSession?: () => void
  save: (args: {
    credential: Credential
    name: string
    visibility: string
    setDefault: boolean
  }) => Promise<void>
}

type EditConnectionModalProps = {
  credential: Credential
  providerName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseComplete: () => void
  dataSource: EditConnectionDataSource
}

export default function EditConnectionModal({
  credential,
  providerName,
  open,
  onOpenChange,
  onCloseComplete,
  dataSource,
}: EditConnectionModalProps) {
  const { t } = useTranslation(['common', 'plugin'])
  const savingRef = useRef(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (savingRef.current) {
          details.cancel()
          return
        }
        onOpenChange(nextOpen)
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) {
          dataSource.resetSession?.()
          onCloseComplete()
        }
      }}
    >
      <DialogContent className="w-140">
        <ConnectionDetailsForm
          title={
            providerName
              ? t(($) => $['auth.connection.saveWithProvider'], {
                  ns: 'plugin',
                  provider: providerName,
                })
              : t(($) => $['auth.connection.save'], { ns: 'plugin' })
          }
          initialName={credential.name}
          initialVisibility={credential.visibility || PermissionLevel.allTeamMembers}
          canEdit={dataSource.canEdit}
          canSetDefault={dataSource.canUse}
          saveLabel={t(($) => $['operation.save'], { ns: 'common' })}
          onSave={(values) => dataSource.save({ credential, ...values })}
          onCancel={() => onOpenChange(false)}
          onSavingChange={(saving) => {
            savingRef.current = saving
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
