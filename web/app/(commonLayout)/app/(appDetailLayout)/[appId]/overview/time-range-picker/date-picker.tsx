'use client'
import { RiCalendarLine } from '@remixicon/react'
import type { Dayjs } from 'dayjs'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import cn from '@/utils/classnames'
import { formatToLocalTime } from '@/utils/format'
import { useI18N } from '@/context/i18n'
import Picker from '@/app/components/base/date-and-time-picker/date-picker'
import type { TriggerProps } from '@/app/components/base/date-and-time-picker/types'
import { noop } from 'lodash-es'

type Props = {
  start: Dayjs
  end: Dayjs
  onStartChange: (date?: Dayjs) => void
  onEndChange: (date?: Dayjs) => void
}

const DatePicker: FC<Props> = ({
  start,
  end,
  onStartChange,
  onEndChange,
}) => {
  const { locale } = useI18N()

  const renderDate = useCallback(({ value, handleClickTrigger, isOpen }: TriggerProps) => {
    return (
      <div className={cn('system-sm-regular flex h-7 cursor-pointer items-center rounded-lg px-1 text-components-input-text-filled hover:bg-state-base-hover', isOpen && 'bg-state-base-hover')} onClick={handleClickTrigger}>
        {value ? formatToLocalTime(value, locale, 'MMM D') : ''}
      </div>
    )
  }, [locale])
  return (
    <div className='flex h-8 items-center space-x-0.5 rounded-lg bg-components-input-bg-normal px-2'>
      <div className='p-px'>
        <RiCalendarLine className='size-3.5 text-text-tertiary' />
      </div>
      <Picker
        value={start}
        onChange={onStartChange}
        renderTrigger={renderDate}
        needTimePicker={false}
        onClear={noop}
      />
      <span className='system-sm-regular text-text-tertiary'>-</span>
      <Picker
        value={end}
        onChange={onEndChange}
        renderTrigger={renderDate}
        needTimePicker={false}
        onClear={noop}
      />
    </div>

  )
}
export default React.memo(DatePicker)
