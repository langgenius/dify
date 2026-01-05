'use client'

import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'

type Props = {
  isShow: boolean
  onHide: () => void
  onConfirm: () => void
}

const ClearAllAnnotationsConfirmModal: FC<Props> = ({
  isShow,
  onHide,
  onConfirm,
}) => {
  const { t } = useTranslation()

  return (
    <Confirm
      isShow={isShow}
      onCancel={onHide}
      onConfirm={onConfirm}
      type="danger"
      title={t('table.header.clearAllConfirm', { ns: 'appAnnotation' })}
    />
  )
}

export default React.memo(ClearAllAnnotationsConfirmModal)
