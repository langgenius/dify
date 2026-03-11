'use client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import { ToastContext } from '@/app/components/base/toast/context'
import { Dialog, DialogContent } from '@/app/components/base/ui/dialog'
import { useAppContext } from '@/context/app-context'
import { updateWorkspaceInfo } from '@/service/common'

type IEditWorkspaceModalProps = {
  onCancel: () => void
}
const EditWorkspaceModal = ({
  onCancel,
}: IEditWorkspaceModalProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { currentWorkspace, isCurrentWorkspaceOwner } = useAppContext()
  const [name, setName] = useState<string>(currentWorkspace.name)

  const changeWorkspaceInfo = async (name: string) => {
    try {
      await updateWorkspaceInfo({
        url: '/workspaces/info',
        body: {
          name,
        },
      })
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
      location.assign(`${location.origin}`)
    }
    catch {
      notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
    >
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="overflow-visible"
      >
        <div className="mb-2 flex justify-between">
          <div className="text-xl font-semibold text-text-primary" data-testid="edit-workspace-title">{t('account.editWorkspaceInfo', { ns: 'common' })}</div>
          <div className="i-ri-close-line h-4 w-4 cursor-pointer text-text-tertiary" data-testid="edit-workspace-close" onClick={onCancel} />
        </div>
        <div>
          <div className="mb-2 text-sm font-medium text-text-primary">{t('account.workspaceName', { ns: 'common' })}</div>
          <Input
            className="mb-2"
            value={name}
            placeholder={t('account.workspaceNamePlaceholder', { ns: 'common' })}
            onChange={(e) => {
              setName(e.target.value)
            }}
            onClear={() => {
              setName(currentWorkspace.name)
            }}
            showClearIcon
          />

          <div className="sticky bottom-0 -mx-2 mt-2 flex flex-wrap items-center justify-end gap-x-2 bg-components-panel-bg px-2 pt-4">
            <Button
              size="large"
              data-testid="edit-workspace-cancel"
              onClick={onCancel}
            >
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button
              size="large"
              variant="primary"
              data-testid="edit-workspace-confirm"
              onClick={() => {
                changeWorkspaceInfo(name)
                onCancel()
              }}
              disabled={!isCurrentWorkspaceOwner}
            >
              {t('operation.confirm', { ns: 'common' })}
            </Button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  )
}
export default EditWorkspaceModal
