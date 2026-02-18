'use client'
import type { FC } from 'react'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

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
    <div className="h-6 grow rounded-md bg-components-input-bg-normal p-0.5 text-[0]">
      <div className={cn('inline-flex h-5 items-center space-x-0.5 rounded-[5px] border-[0.5px] border-components-panel-border bg-components-badge-white-to-dark pl-1.5 pr-0.5 shadow-xs', readOnly && 'pr-1.5')}>
        <div className="system-xs-regular text-text-secondary">{t('metadata.batchEditMetadata.multipleValue', { ns: 'dataset' })}</div>
        {!readOnly && (
          <div className="cursor-pointer rounded-[4px] p-px text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary">
            <RiCloseLine
              className="size-3.5 "
              onClick={onClear}
            />
          </div>
        )}
      </div>
    </div>
  )
}
export default React.memo(InputHasSetMultipleValue)
