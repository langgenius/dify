'use client'
import { useCallback, useState } from 'react'
import { useContext } from 'use-context-selector'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import s from './index.module.css'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { renameWorkspace } from '@/service/common'
import { ToastContext } from '@/app/components/base/toast'
import type { IWorkspace } from '@/models/common'

type IRenameWorkspaceModalProps = {
  workspace: Pick<IWorkspace, 'id' | 'name'>
  onCancel: () => void
  onRenamed?: (name: string) => void
}

const RenameWorkspaceModal = ({
  workspace,
  onRenamed,
  onCancel,
}: IRenameWorkspaceModalProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

  const [newName, setNewName] = useState(workspace.name)

  const handleRename = useCallback(async () => {
    if (newName.trim().length) {
      try {
        const res = await renameWorkspace({ url: `/workspaces/${workspace.id}/name`, body: { name: newName.trim() } })

        if (res.result === 'success') {
          onRenamed?.(newName.trim())
          onCancel()
        }
      }
      catch (e) {}
    }
    else {
      notify({ type: 'error', message: t('common.members.workspaceNameInvalid') })
    }
  }, [newName, workspace.id, onRenamed, onCancel, notify, t])

  return (
    <div className={s.wrap}>
      <Modal isShow onClose={onCancel} className={s.modal}>
        <div className='flex justify-between mb-2'>
          <div className='text-xl font-semibold text-gray-900'>{t('common.members.renameWorkspace')}</div>
          <XMarkIcon className='w-4 h-4 cursor-pointer' onClick={onCancel} />
        </div>
        <div>
          <div className='mb-2 text-sm font-medium text-gray-900'>{t('common.members.workspaceName')}</div>
          <input
            className='
              block w-full py-2 mb-9 px-3 bg-gray-50 outline-none border-none
              appearance-none text-sm text-gray-900 rounded-lg
            '
            defaultValue={workspace.name}
            onChange={e => setNewName(e.target.value)}
            placeholder={t('common.members.renamePlaceholder') || ''}
          />
          <Button
            className='w-full text-sm font-medium'
            onClick={handleRename}
            type='primary'
          >
            {t('common.members.rename')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

export default RenameWorkspaceModal
