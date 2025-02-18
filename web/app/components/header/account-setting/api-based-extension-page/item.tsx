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
import Confirm from '@/app/components/base/confirm'

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
    <div className='hover:shadow-xs group mb-2 flex items-center rounded-xl border-[0.5px] border-transparent bg-gray-50 px-4 py-2 hover:border-gray-200'>
      <div className='grow'>
        <div className='mb-0.5 text-[13px] font-medium text-gray-700'>{data.name}</div>
        <div className='text-xs text-gray-500'>{data.api_endpoint}</div>
      </div>
      <div className='hidden items-center group-hover:flex'>
        <div
          className='shadow-xs mr-1 flex h-7 cursor-pointer items-center rounded-md border-[0.5px] border-gray-200 bg-white px-3 text-xs font-medium text-gray-700'
          onClick={handleOpenApiBasedExtensionModal}
        >
          <Edit02 className='mr-[5px] h-3.5 w-3.5' />
          {t('common.operation.edit')}
        </div>
        <div
          className='shadow-xs flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-[0.5px] border-gray-200 bg-white text-gray-700'
          onClick={() => setShowDeleteConfirm(true)}
        >
          <RiDeleteBinLine className='h-4 w-4' />
        </div>
      </div>
      {
        showDeleteConfirm
          && <Confirm
            isShow={showDeleteConfirm}
            onCancel={() => setShowDeleteConfirm(false)}
            title={`${t('common.operation.delete')} “${data.name}”?`}
            onConfirm={handleDeleteApiBasedExtension}
            confirmText={t('common.operation.delete') || ''}
          />
      }
    </div>
  )
}

export default Item
