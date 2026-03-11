'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'

type Props = {
  name: string
  value: boolean
  required?: boolean
  onChange: (value: boolean) => void
  readonly?: boolean
}

const BoolInput: FC<Props> = ({
  value,
  onChange,
  name,
  required,
  readonly,
}) => {
  const { t } = useTranslation()
  const handleChange = useCallback(() => {
    onChange(!value)
  }, [value, onChange])
  return (
    <div className="flex h-6 items-center gap-2">
      <Checkbox
        className="!h-4 !w-4"
        checked={!!value}
        onCheck={handleChange}
        disabled={readonly}
      />
      <div className="system-sm-medium flex items-center gap-1 text-text-secondary">
        {name}
        {!required && <span className="system-xs-regular text-text-tertiary">{t('panel.optional', { ns: 'workflow' })}</span>}
      </div>
    </div>
  )
}
export default React.memo(BoolInput)
