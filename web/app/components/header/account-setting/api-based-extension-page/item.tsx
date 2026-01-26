import type { FC } from 'react'
import type { ApiBasedExtension } from '@/models/common'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import { useModalContext } from '@/context/modal-context'
import { deleteApiBasedExtension } from '@/service/common'

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
    <div className="group mb-2 flex items-center rounded-xl border-[0.5px] border-transparent bg-components-input-bg-normal px-4 py-2 hover:border-components-input-border-active hover:shadow-xs">
      <div className="grow">
        <div className="mb-0.5 text-[13px] font-medium text-text-secondary">{data.name}</div>
        <div className="text-xs text-text-tertiary">{data.api_endpoint}</div>
      </div>
      <div className="hidden items-center group-hover:flex">
        <Button
          className="mr-1"
          onClick={handleOpenApiBasedExtensionModal}
        >
          <RiEditLine className="mr-1 h-4 w-4" />
          {t('operation.edit', { ns: 'common' })}
        </Button>
        <Button
          onClick={() => setShowDeleteConfirm(true)}
        >
          <RiDeleteBinLine className="mr-1 h-4 w-4" />
          {t('operation.delete', { ns: 'common' })}
        </Button>
      </div>
      {
        showDeleteConfirm
        && (
          <Confirm
            isShow={showDeleteConfirm}
            onCancel={() => setShowDeleteConfirm(false)}
            title={`${t('operation.delete', { ns: 'common' })} “${data.name}”?`}
            onConfirm={handleDeleteApiBasedExtension}
            confirmText={t('operation.delete', { ns: 'common' }) || ''}
          />
        )
      }
    </div>
  )
}

export default Item
