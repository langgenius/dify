'use client'
import { RiInformation2Fill } from '@remixicon/react'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import { useTranslation } from 'react-i18next'

type Props = {
  textHasNoExport?: boolean
  downloadUrl?: string
  className?: string
}

const LargeDataAlert: FC<Props> = ({
  textHasNoExport,
  downloadUrl,
  className,
}) => {
  const { t } = useTranslation()
  const text = textHasNoExport ? t('workflow.debug.variableInspect.largeDataNoExport') : t('workflow.debug.variableInspect.largeData')
  return (
    <div className={cn('flex h-8 items-center justify-between rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-2 shadow-xs', className)}>
      <div className='flex h-full w-0 grow items-center space-x-1'>
        <RiInformation2Fill className='size-4 shrink-0 text-text-accent' />
        <div className='system-xs-regular w-0 grow truncate text-text-primary'>{text}</div>
      </div>
      {downloadUrl && (
        <div className='system-xs-medium-uppercase ml-1 shrink-0 cursor-pointer text-text-accent'>{t('workflow.debug.variableInspect.export')}</div>
      )}
    </div>
  )
}
export default React.memo(LargeDataAlert)
