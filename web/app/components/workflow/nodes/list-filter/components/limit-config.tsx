'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { Limit } from '../types'
import cn from '@/utils/classnames'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Switch from '@/app/components/base/switch'
import Slider from '@/app/components/base/slider'

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

  const handleBlur = useCallback(() => {
    const payload = config
    if (!payload)
      return

    if (payload.size === undefined || payload.size === null)
      handleLimitSizeChange(LIMIT_SIZE_DEFAULT)
  }, [handleLimitSizeChange, config])

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
        {payload && (
          <div className='flex justify-between items-center h-8 space-x-2'>
            <input
              value={(payload?.size || LIMIT_SIZE_DEFAULT) as number}
              className='shrink-0 block pl-3 w-12 h-8 appearance-none outline-none rounded-lg bg-gray-100 text-[13px] text-gra-900'
              type='number'
              min={LIMIT_SIZE_MIN}
              max={LIMIT_SIZE_MAX}
              step={1}
              onChange={e => handleLimitSizeChange(e.target.value)}
              onBlur={handleBlur}
              disabled={readonly || !payload?.enabled}
            />
            <Slider
              className='grow'
              value={(payload?.size || LIMIT_SIZE_DEFAULT) as number}
              min={LIMIT_SIZE_MIN}
              max={LIMIT_SIZE_MAX}
              step={1}
              onChange={handleLimitSizeChange}
              disabled={readonly || !payload?.enabled}
            />
          </div>
        )}
      </Field>
    </div>
  )
}
export default React.memo(LimitConfig)
