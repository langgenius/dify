'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type IModalFootProps = {
  onConfirm: () => void
  onCancel: () => void
}

const ModalFoot: FC<IModalFootProps> = ({
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation()
  return (
    <div className="flex justify-end gap-2">
      <Button onClick={onCancel}>{t('operation.cancel', { ns: 'common' })}</Button>
      <Button variant="primary" onClick={onConfirm}>{t('operation.save', { ns: 'common' })}</Button>
    </div>
  )
}
export default React.memo(ModalFoot)
