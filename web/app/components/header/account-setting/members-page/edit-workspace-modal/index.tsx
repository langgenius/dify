'use client'
import cn from '@/utils/classnames'
import Modal from '@/app/components/base/modal'
import Input from '@/app/components/base/input'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useContext } from 'use-context-selector'
import s from './index.module.css'
import Button from '@/app/components/base/button'
import { RiCloseLine } from '@remixicon/react'
import { useAppContext } from '@/context/app-context'
import { updateWorkspaceInfo } from '@/service/common'
import { ToastContext } from '@/app/components/base/toast'
type IEditWorkspaceModalProps = {
  onCancel: () => void
}
const EditWorkspaceModal = ({
  onCancel,
}: IEditWorkspaceModalProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { currentWorkspace, isCurrentWorkspaceOwner, mutateCurrentWorkspace } = useAppContext()
  const [name, setName] = useState<string>(currentWorkspace.name)

  const changeWorkspaceInfo = async (name: string) => {
    try {
      await updateWorkspaceInfo({
        url: '/workspaces/info',
        body: {
          name,
        },
      })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      location.assign(`${location.origin}`)
    }
    catch (e) {
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
  }

  return (
    <div className={cn(s.wrap)}>
      <Modal overflowVisible isShow onClose={() => {}} className={cn(s.modal)}>
        <div className='mb-2 flex justify-between'>
          <div className='text-xl font-semibold text-text-primary'>{t('common.account.editWorkspaceInfo')}</div>
          <RiCloseLine className='h-4 w-4 cursor-pointer text-text-tertiary' onClick={onCancel} />
        </div>
        <div>
          <div className='mb-2 text-sm font-medium text-text-primary'>{t('common.account.workspaceName')}</div>
          <Input
            className='mb-2'
            value={name}
            placeholder={t('common.account.workspaceNamePlaceholder')}
            onChange={(e) => {
              setName(e.target.value)
            }}
            onClear={() => {
              setName(currentWorkspace.name)
            }}
          />

          <div className='sticky bottom-0 -mx-2 mt-2 flex flex-wrap items-center justify-end gap-x-2 bg-components-panel-bg px-2 pt-4'>
            <Button
              size='large'
              onClick={onCancel}
            >
              {t('common.operation.cancel')}
            </Button>
            <Button
              size='large'
              variant='primary'
              onClick={() => {
                changeWorkspaceInfo(name)
                onCancel()
              }}
              disabled={!isCurrentWorkspaceOwner}
            >
              {t('common.operation.confirm')}
            </Button>
          </div>

        </div>
      </Modal>
    </div>
  )
}
export default EditWorkspaceModal
