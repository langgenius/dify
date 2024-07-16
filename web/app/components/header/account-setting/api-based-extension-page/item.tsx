import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import { Edit02 } from '@/app/components/base/icons/src/vender/line/general'
import type { ApiBasedExtension } from '@/models/common'
import { useModalContext } from '@/context/modal-context'
import { deleteApiBasedExtension } from '@/service/common'
import ConfirmCommon from '@/app/components/base/confirm/common'

type ItemProps = {
  data: ApiBasedExtension
  onUpdate: () => void
}
const Item: FC<ItemProps> = ({
  data,
  onUpdate,
}) => {
  const { t } = useTranslation()
  const { setShowApiBasedExtensionModal } = useModalContext()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleOpenApiBasedExtensionModal = () => {
    setShowApiBasedExtensionModal({
      payload: data,
      onSaveCallback: () => onUpdate(),
    })
  }
  const handleDeleteApiBasedExtension = async () => {
    await deleteApiBasedExtension(`/api-based-extension/${data.id}`)

    setShowDeleteConfirm(false)
    onUpdate()
  }

  return (
    <div className='group flex items-center mb-2 px-4 py-2 border-[0.5px] border-transparent rounded-xl bg-gray-50 hover:border-gray-200 hover:shadow-xs'>
      <div className='grow'>
        <div className='mb-0.5 text-[13px] font-medium text-gray-700'>{data.name}</div>
        <div className='text-xs text-gray-500'>{data.api_endpoint}</div>
      </div>
      <div className='hidden group-hover:flex items-center'>
        <div
          className='flex items-center mr-1 px-3 h-7 bg-white text-xs font-medium text-gray-700 rounded-md border-[0.5px] border-gray-200 shadow-xs cursor-pointer'
          onClick={handleOpenApiBasedExtensionModal}
        >
          <Edit02 className='mr-[5px] w-3.5 h-3.5' />
          {t('common.operation.edit')}
        </div>
        <div
          className='flex items-center justify-center w-7 h-7 bg-white text-gray-700 rounded-md border-[0.5px] border-gray-200 shadow-xs cursor-pointer'
          onClick={() => setShowDeleteConfirm(true)}
        >
          <RiDeleteBinLine className='w-4 h-4' />
        </div>
      </div>
      {
        showDeleteConfirm && (
          <ConfirmCommon
            type='danger'
            isShow={showDeleteConfirm}
            onCancel={() => setShowDeleteConfirm(false)}
            title={`${t('common.operation.delete')} “${data.name}”?`}
            onConfirm={handleDeleteApiBasedExtension}
            confirmWrapperClassName='!z-30'
            confirmText={t('common.operation.delete') || ''}
            confirmBtnClassName='!bg-[#D92D20]'
          />
        )
      }
    </div>
  )
}

export default Item
