import type { DialogContentProps } from '@langgenius/dify-ui/dialog'
import type { ConnectionDetailsValues } from './connection-details-form'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { PermissionLevel } from '@/models/permission'
import ConnectionDetailsForm from './connection-details-form'

export type SaveConnectionValues = ConnectionDetailsValues

export type SaveConnectionDataSource = {
  save: (values: SaveConnectionValues) => Promise<void>
}

type Props = {
  providerName: string
  accountName?: string
  defaultName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseComplete?: () => void
  finalFocus?: DialogContentProps['finalFocus']
  disabled?: boolean
  canSetDefault?: boolean
  dataSource: SaveConnectionDataSource
}

// Mount only for an explicitly completed authorization session. This component
// does not infer success or a credential identity from popup closure/list refreshes.
export default function SaveConnectionModal({
  providerName,
  accountName,
  defaultName = '',
  open,
  onOpenChange,
  onCloseComplete,
  finalFocus,
  disabled = false,
  canSetDefault = true,
  dataSource,
}: Props) {
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
        if (!nextOpen) onCloseComplete?.()
      }}
    >
      <DialogContent className="w-140" finalFocus={finalFocus}>
        <ConnectionDetailsForm
          title={t(($) => $['auth.connection.saveWithProvider'], {
            ns: 'plugin',
            provider: providerName,
          })}
          accountName={accountName}
          initialName={defaultName}
          initialVisibility={PermissionLevel.allTeamMembers}
          canEdit={!disabled}
          canSetDefault={canSetDefault}
          saveLabel={t(($) => $['auth.connection.save'], { ns: 'plugin' })}
          onSave={dataSource.save}
          onCancel={() => onOpenChange(false)}
          onSavingChange={(saving) => {
            savingRef.current = saving
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
