'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type StartTabItemProps = {
  isActive: boolean
  onClick: () => void
}

const StartTabItem = ({
  isActive,
  onClick,
}: StartTabItemProps) => {
  const { t } = useTranslation('workflow')

  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center border-r border-components-panel-border-subtle',
        isActive ? 'bg-components-panel-bg' : 'bg-transparent hover:bg-state-base-hover',
      )}
    >
      <button
        type="button"
        className={cn(
          'flex items-center gap-1 px-2.5 pb-2 pt-2.5',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
        )}
        onClick={onClick}
      >
        <div className="flex size-5 shrink-0 items-center justify-center">
          <span className={cn(
            'i-custom-vender-workflow-home size-4',
            isActive ? 'text-text-secondary' : 'text-text-tertiary',
          )}
          />
        </div>
        <span
          className={cn(
            'text-[13px] font-medium uppercase leading-4',
            isActive ? 'text-text-primary' : 'text-text-tertiary',
          )}
        >
          {t('skillSidebar.startTab')}
        </span>
      </button>
    </div>
  )
}

export default React.memo(StartTabItem)
