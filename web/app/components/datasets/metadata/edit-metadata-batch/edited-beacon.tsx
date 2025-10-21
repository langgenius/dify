'use client'
import type { FC } from 'react'
import React, { useRef } from 'react'
import { useHover } from 'ahooks'
import { RiResetLeftLine } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import { useTranslation } from 'react-i18next'

type Props = {
  onReset: () => void
}

const EditedBeacon: FC<Props> = ({
  onReset,
}) => {
  const { t } = useTranslation()
  const ref = useRef(null)
  const isHovering = useHover(ref)

  return (
    <div ref={ref} className='size-4 cursor-pointer'>
      {isHovering ? (
        <Tooltip popupContent={t('common.operation.reset')}>
          <div className='flex size-4 items-center justify-center rounded-full bg-text-accent-secondary' onClick={onReset}>
            <RiResetLeftLine className='size-[10px] text-text-primary-on-surface' />
          </div>
        </Tooltip>
      ) : (
        <div className='flex size-4 items-center justify-center'>
          <div className='size-1 rounded-full bg-text-accent-secondary'></div>
        </div>
      )}
    </div>
  )
}
export default React.memo(EditedBeacon)
