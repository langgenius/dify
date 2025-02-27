'use client'
import { RiCloseLine } from '@remixicon/react'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'

type Props = {
  onClear: () => void
  readOnly?: boolean
}

const InputHasSetMultipleValue: FC<Props> = ({
  onClear,
  readOnly,
}) => {
  const { t } = useTranslation()
  return (
    <div className='grow h-6 p-0.5 rounded-md bg-components-input-bg-normal text-[0]'>
      <div className={cn('inline-flex rounded-[5px] items-center h-5 pl-1.5 pr-0.5 bg-components-badge-white-to-dark border-[0.5px] border-components-panel-border shadow-xs space-x-0.5', readOnly && 'pr-1.5')}>
        <div className='system-xs-regular text-text-secondary'>{t('dataset.metadata.batchEditMetadata.multipleValue')}</div>
        {!readOnly && (
          <div className='p-px rounded-[4px] text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary cursor-pointer'>
            <RiCloseLine
              className='size-3.5 '
              onClick={onClear}
            />
          </div>
        )}
      </div>
    </div>
  )
}
export default React.memo(InputHasSetMultipleValue)
