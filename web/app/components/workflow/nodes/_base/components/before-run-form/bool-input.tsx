'use client'
import type { FC } from 'react'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from '#i18n'

type Props = Readonly<{
  name: string
  value: boolean
  required?: boolean
  onChange: (value: boolean) => void
  readonly?: boolean
}>

const BoolInput: FC<Props> = ({
  value,
  onChange,
  name,
  required,
  readonly,
}) => {
  const { t } = useTranslation()
  const handleChange = useCallback((checked: boolean) => {
    onChange(checked)
  }, [onChange])
  return (
    <label className="flex h-6 items-center gap-2">
      <Checkbox
        className="size-4!"
        checked={!!value}
        onCheckedChange={handleChange}
        disabled={readonly}
      />
      <div className="flex items-center gap-1 system-sm-medium text-text-secondary">
        {name}
        {!required && <span className="system-xs-regular text-text-tertiary">{t('panel.optional', { ns: 'workflow' })}</span>}
      </div>
    </label>
  )
}
export default React.memo(BoolInput)
