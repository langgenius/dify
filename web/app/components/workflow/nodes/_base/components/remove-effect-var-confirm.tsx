'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'

type Props = {
  isShow: boolean
  onConfirm: () => void
  onCancel: () => void
}
const i18nPrefix = 'common.effectVarConfirm'

const RemoveVarConfirm: FC<Props> = ({
  isShow,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation()

  return (
    <Confirm
      isShow={isShow}
      title={t(`${i18nPrefix}.title`, { ns: 'workflow' })}
      content={t(`${i18nPrefix}.content`, { ns: 'workflow' })}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
export default React.memo(RemoveVarConfirm)
