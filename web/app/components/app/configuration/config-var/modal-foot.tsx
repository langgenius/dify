'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type IModalFootProps = {
  onConfirm?: () => void
  confirmType?: 'button' | 'submit'
  onCancel: () => void
}

const ModalFoot: FC<IModalFootProps> = ({ onConfirm, onCancel, confirmType = 'button' }) => {
  const { t } = useTranslation()
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" onClick={onCancel}>
        {t(($) => $['operation.cancel'], { ns: 'common' })}
      </Button>
      <Button type={confirmType} variant="primary" onClick={onConfirm}>
        {t(($) => $['operation.save'], { ns: 'common' })}
      </Button>
    </div>
  )
}
export default React.memo(ModalFoot)
