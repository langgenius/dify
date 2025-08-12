import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { Key, Settings } from 'lucide-react'
import {
  RiDeleteBinLine,
  RiRefreshLine,
} from '@remixicon/react'

import Button from '@/app/components/base/button'
import { useAppContext } from '@/context/app-context'
import { useToastContext } from '@/app/components/base/toast'
import { deleteWorkspaceApiKey } from '@/service/workspace-api-key'
import type { WorkspaceApiKey } from '@/service/workspace-api-key'
import Confirm from '@/app/components/base/confirm'
import WorkspaceApiKeyModal from './modal'

type ItemProps = {
  data: WorkspaceApiKey
  onUpdate: () => void
}

const Item: FC<ItemProps> = ({
  data,
  onUpdate,
}) => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceOwner, isCurrentWorkspaceManager } = useAppContext()
  const { notify } = useToastContext()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showRegenerateModal, setShowRegenerateModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)

  const handleDelete = async () => {
    try {
      await deleteWorkspaceApiKey({ keyId: data.id })
      notify({ type: 'success', message: t('common.workspaceApiKey.deleteSuccess') })
      setShowDeleteConfirm(false)
      onUpdate()
    }
    catch (error) {
      console.error('Failed to delete API key:', error)
      notify({ type: 'error', message: t('common.workspaceApiKey.deleteFailed') })
    }
  }

  const formatDate = (date: string | null) => {
    if (!date) return t('common.workspaceApiKey.none')
    return dayjs(date).format('YYYY-MM-DD HH:mm')
  }

  return (
    <div className='group mb-2 flex h-[140px] rounded-xl border-[0.5px] border-transparent bg-components-input-bg-normal px-4 py-3 hover:border-components-input-border-active hover:shadow-xs'>
      <div className='flex flex-1 flex-col'>
        <div className='flex-1'>
          <div className='mb-2 flex items-center'>
            <Key className='mr-2 h-4 w-4 text-text-tertiary' />
            <span className='truncate text-[13px] font-medium text-text-primary'>{data.name}</span>
          </div>
          <div className='h-[48px] overflow-hidden'>
            <div className='flex flex-wrap gap-1'>
              {data.scopes.map((scope: string) => (
                <span
                  key={scope}
                  className='inline-flex items-center whitespace-nowrap rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] leading-tight text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                >
                  {scope}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className='mt-auto pt-2'>
          <div className='grid grid-cols-3 gap-2 text-xs text-text-tertiary'>
            <div className='truncate'>
              <span className='block font-medium'>{t('common.workspaceApiKey.createdAt')}</span>
              <span className='block'>{formatDate(data.created_at)}</span>
            </div>
            <div className='truncate'>
              <span className='block font-medium'>{t('common.workspaceApiKey.lastUsedAt')}</span>
              <span className='block'>{formatDate(data.last_used_at)}</span>
            </div>
            <div className='truncate'>
              <span className='block font-medium'>{t('common.workspaceApiKey.expiresAt')}</span>
              <span className='block'>{formatDate(data.expires_at)}</span>
            </div>
          </div>
        </div>
      </div>
      <div className='ml-4 flex w-0 flex-col justify-center gap-1 overflow-hidden transition-all duration-200 group-hover:w-[180px]'>
        <Button
          variant='secondary'
          size='small'
          onClick={() => setShowDetailModal(true)}
        >
          <Settings className='mr-1 h-3 w-3' />
          {t('common.operation.edit')}
        </Button>
        <Button
          variant='primary'
          size='small'
          className='!h-auto !bg-components-button-indigo-bg !px-2 !py-1.5 text-xs leading-tight !text-white hover:!bg-components-button-indigo-bg-hover'
          onClick={() => setShowRegenerateModal(true)}
          disabled={!isCurrentWorkspaceOwner && !isCurrentWorkspaceManager}
        >
          <RiRefreshLine className='mr-1 h-4 w-4 shrink-0' />
          <span className='whitespace-pre-line text-center'>{t('common.workspaceApiKey.regenerate')}</span>
        </Button>
        <Button
          variant='secondary'
          size='small'
          destructive
          className='!border-components-button-destructive-secondary-border !bg-components-button-destructive-secondary-bg !text-components-button-destructive-secondary-text hover:!bg-components-button-destructive-secondary-bg-hover'
          onClick={() => setShowDeleteConfirm(true)}
          disabled={!isCurrentWorkspaceOwner && !isCurrentWorkspaceManager}
        >
          <RiDeleteBinLine className='mr-1 h-3 w-3' />
          {t('common.operation.delete')}
        </Button>
      </div>

      {showDeleteConfirm && (
        <Confirm
          isShow={showDeleteConfirm}
          onCancel={() => setShowDeleteConfirm(false)}
          title={t('common.workspaceApiKey.modal.deleteTitle')}
          desc={t('common.workspaceApiKey.modal.deleteDescription')}
          onConfirm={handleDelete}
          confirmText={t('common.operation.delete')}
          confirmButtonClass='!bg-components-button-destructive-primary-bg !text-components-button-destructive-primary-text hover:!bg-components-button-destructive-primary-bg-hover'
        />
      )}

      {showRegenerateModal && (
        <WorkspaceApiKeyModal
          data={data}
          isRegenerate
          onCancel={() => setShowRegenerateModal(false)}
          onSave={() => {
            setShowRegenerateModal(false)
            onUpdate()
          }}
        />
      )}

      {showDetailModal && (
        <WorkspaceApiKeyModal
          data={data}
          isEdit
          onCancel={() => setShowDetailModal(false)}
          onSave={() => {
            setShowDetailModal(false)
            onUpdate()
          }}
        />
      )}
    </div>
  )
}

export default Item
