'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'

type Props = {
  isShow: boolean
  onConfirm: () => void
  onCancel: () => void
}
const i18nPrefix = 'workflow.common.effectVarConfirm'

const RemoveVarConfirm: FC<Props> = ({
  isShow,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation()

  return (
    <Confirm
      isShow={isShow}
      title={t(`${i18nPrefix}.title`)}
      content={t(`${i18nPrefix}.content`)}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
export default React.memo(RemoveVarConfirm)
