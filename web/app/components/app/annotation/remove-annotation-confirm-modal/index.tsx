'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import DeleteConfirmModal from '@/app/components/base/modal/delete-confirm-modal'

type Props = {
  isShow: boolean
  onHide: () => void
  onRemove: () => void
}

const RemoveAnnotationConfirmModal: FC<Props> = ({
  isShow,
  onHide,
  onRemove,
}) => {
  const { t } = useTranslation()

  return (
    <DeleteConfirmModal
      isShow={isShow}
      onHide={onHide}
      onRemove={onRemove}
      text={t('appDebug.feature.annotation.removeConfirm') as string}
    />
  )
}
export default React.memo(RemoveAnnotationConfirmModal)
