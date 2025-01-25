'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { Limit } from '../types'
import InputNumberWithSlider from '../../_base/components/input-number-with-slider'
import cn from '@/utils/classnames'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Switch from '@/app/components/base/switch'

const i18nPrefix = 'workflow.nodes.listFilter'
const LIMIT_SIZE_MIN = 1
const LIMIT_SIZE_MAX = 20
const LIMIT_SIZE_DEFAULT = 10

type Props = {
  className?: string
  readonly: boolean
  config: Limit
  onChange: (limit: Limit) => void
  canSetRoleName?: boolean
}

const LIMIT_DEFAULT: Limit = {
  enabled: false,
  size: LIMIT_SIZE_DEFAULT,
}

const LimitConfig: FC<Props> = ({
  className,
  readonly,
  config = LIMIT_DEFAULT,
  onChange,
}) => {
  const { t } = useTranslation()
  const payload = config

  const handleLimitEnabledChange = useCallback((enabled: boolean) => {
    onChange({
      ...config,
      enabled,
    })
  }, [config, onChange])

  const handleLimitSizeChange = useCallback((size: number | string) => {
    onChange({
      ...config,
      size: parseInt(size as string),
    })
  }, [onChange, config])

  return (
    <div className={cn(className)}>
      <Field
        title={t(`${i18nPrefix}.limit`)}
        operations={
          <Switch
            defaultValue={payload.enabled}
            onChange={handleLimitEnabledChange}
            size='md'
            disabled={readonly}
          />
        }
      >
        {payload?.enabled
          ? (
            <InputNumberWithSlider
              value={payload?.size || LIMIT_SIZE_DEFAULT}
              min={LIMIT_SIZE_MIN}
              max={LIMIT_SIZE_MAX}
              onChange={handleLimitSizeChange}
              readonly={readonly || !payload?.enabled}
            />
          )
          : null}
      </Field>
    </div>
  )
}
export default React.memo(LimitConfig)
