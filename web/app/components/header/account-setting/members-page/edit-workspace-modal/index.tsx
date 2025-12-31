'use client'
import { RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import { ToastContext } from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import { updateWorkspaceInfo } from '@/service/common'
import { cn } from '@/utils/classnames'
import s from './index.module.css'

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
    <div className={cn(s.wrap)}>
      <Modal overflowVisible isShow onClose={noop} className={cn(s.modal)}>
        <div className="mb-2 flex justify-between">
          <div className="text-xl font-semibold text-text-primary">{t('account.editWorkspaceInfo', { ns: 'common' })}</div>
          <RiCloseLine className="h-4 w-4 cursor-pointer text-text-tertiary" onClick={onCancel} />
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
          />

          <div className="sticky bottom-0 -mx-2 mt-2 flex flex-wrap items-center justify-end gap-x-2 bg-components-panel-bg px-2 pt-4">
            <Button
              size="large"
              onClick={onCancel}
            >
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button
              size="large"
              variant="primary"
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
      </Modal>
    </div>
  )
}
export default EditWorkspaceModal
