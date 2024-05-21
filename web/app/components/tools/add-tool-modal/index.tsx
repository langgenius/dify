'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { CustomCollectionBackend } from '../types'
import Drawer from '@/app/components/base/drawer'
// import Button from '@/app/components/base/button'
// import AppIcon from '@/app/components/base/app-icon'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import { createCustomCollection } from '@/service/tools'
import Toast from '@/app/components/base/toast'

type Props = {
  onHide: () => void
}
// Add and Edit
const AddToolModal: FC<Props> = ({
  onHide,
}) => {
  const { t } = useTranslation()

  const [isShowEditCollectionToolModal, setIsShowEditCustomCollectionModal] = useState(false)
  const doCreateCustomToolCollection = async (data: CustomCollectionBackend) => {
    await createCustomCollection(data)
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    setIsShowEditCustomCollectionModal(false)
    // TODO update list
  }

  return (
    <>
      <Drawer
        isOpen
        mask
        clickOutsideNotOpen
        onClose={onHide}
        // title={t('workflow.common.workflowAsTool')!}
        footer={null}
        panelClassname={cn('mt-16 mx-2 sm:mr-2 mb-3 !p-0 rounded-xl', 'mt-2 !w-[640px]', '!max-w-[640px]')}
      >
        <div
          className={cn('bg-gray-100', 'w-full flex flex-col bg-white border-[0.5px] border-gray-200 rounded-xl shadow-xl')}
          style={{
            height: 'calc(100vh - 16px)',
          }}
        >
        </div>
      </Drawer>
      {isShowEditCollectionToolModal && (
        <EditCustomToolModal
          payload={null}
          onHide={() => setIsShowEditCustomCollectionModal(false)}
          onAdd={doCreateCustomToolCollection}
        />
      )}
    </>

  )
}
export default React.memo(AddToolModal)
