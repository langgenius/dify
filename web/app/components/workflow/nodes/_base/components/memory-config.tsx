'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import cn from 'classnames'
import type { Memory } from '../../../types'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Switch from '@/app/components/base/switch'
import Slider from '@/app/components/base/slider'

const i18nPrefix = 'workflow.nodes.common.memory'

type Props = {
  className?: string
  readonly: boolean
  payload: Memory
  onChange: (memory: Memory) => void
  canSetRoleName?: boolean
}

const WINDOW_SIZE_MIN = 1
const WINDOW_SIZE_MAX = 100
const WINDOW_SIZE_DEFAULT = 50

const MemoryConfig: FC<Props> = ({
  className,
  readonly,
  payload,
  onChange,
  canSetRoleName = false,
}) => {
  const { t } = useTranslation()
  const handleWindowEnabledChange = useCallback((enabled: boolean) => {
    const newPayload = produce(payload, (draft) => {
      if (!draft.window)
        draft.window = { enabled: false, size: WINDOW_SIZE_DEFAULT }

      draft.window.enabled = enabled
    })
    onChange(newPayload)
  }, [payload, onChange])

  const handleWindowSizeChange = useCallback((size: number | string) => {
    const newPayload = produce(payload, (draft) => {
      if (!draft.window)
        draft.window = { enabled: true, size: WINDOW_SIZE_DEFAULT }
      let limitedSize: null | string | number = size
      if (limitedSize === '') {
        limitedSize = null
      }
      else {
        limitedSize = parseInt(limitedSize as string, 10)
        if (isNaN(limitedSize))
          limitedSize = WINDOW_SIZE_DEFAULT

        if (limitedSize < WINDOW_SIZE_MIN)
          limitedSize = WINDOW_SIZE_MIN

        if (limitedSize > WINDOW_SIZE_MAX)
          limitedSize = WINDOW_SIZE_MAX
      }

      draft.window.size = limitedSize as number
    })
    onChange(newPayload)
  }, [payload, onChange])

  const handleBlur = useCallback(() => {
    if (payload.window.size === '' || payload.window.size === null)
      handleWindowSizeChange(WINDOW_SIZE_DEFAULT)
  }, [handleWindowSizeChange, payload.window?.size])
  return (
    <div className={cn(className)}>
      <Field
        title={t(`${i18nPrefix}.memory`)}
        tooltip={t(`${i18nPrefix}.memoryTip`)!}
      >
        <>
          {/* window size */}
          <div className='flex justify-between'>
            <div className='flex items-center h-8 space-x-1'>
              <Switch
                defaultValue={payload.window?.enabled}
                onChange={handleWindowEnabledChange}
                size='md'
                disabled={readonly}
              />
              <div className='leading-[18px] text-xs font-medium text-gray-500 uppercase'>{t(`${i18nPrefix}.windowSize`)}</div>
            </div>
            <div className='flex items-center h-8 space-x-2'>
              <Slider
                className='w-[144px]'
                value={payload.window?.size as number}
                min={WINDOW_SIZE_MIN}
                max={WINDOW_SIZE_MAX}
                step={1}
                onChange={handleWindowSizeChange}
                disabled={readonly}
              />
              <input
                value={payload.window?.size as number}
                className='shrink-0 block ml-4 pl-3 w-12 h-8 appearance-none outline-none rounded-lg bg-gray-100 text-[13px] text-gra-900'
                type='number'
                min={WINDOW_SIZE_MIN}
                max={WINDOW_SIZE_MAX}
                step={1}
                onChange={e => handleWindowSizeChange(e.target.value)}
                onBlur={handleBlur}
                disabled={readonly}
              />
            </div>
          </div>
          {canSetRoleName && (
            <div>Role name</div>
          )}
        </>
      </Field>
    </div>
  )
}
export default React.memo(MemoryConfig)
