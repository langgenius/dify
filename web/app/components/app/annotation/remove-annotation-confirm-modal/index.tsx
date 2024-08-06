'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'

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
    <Confirm
      isShow={isShow}
      onCancel={onHide}
      onConfirm={onRemove}
      title={t('appDebug.feature.annotation.removeConfirm')}
    />
  )
}
export default React.memo(RemoveAnnotationConfirmModal)
