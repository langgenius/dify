'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import { Group } from '@/app/components/base/icons/src/vender/other'
import { SearchMenu } from '@/app/components/base/icons/src/vender/line/general'
import { useTranslation } from 'react-i18next'

type Props = {
  className: string
  noPlugins?: boolean
}

const NoDataPlaceholder: FC<Props> = ({
  className,
  noPlugins,
}) => {
  const { t } = useTranslation()
  const icon = noPlugins ? (<Group className='size-6 text-text-quaternary' />) : (<SearchMenu className='size-8 text-text-tertiary' />)
  const text = t(`plugin.autoUpdate.noPluginPlaceholder.${noPlugins ? 'noInstalled' : 'noFound'}`)
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div className='flex flex-col items-center'>
        {icon}
        <div className='system-sm-regular mt-2 text-text-tertiary'>{text}</div>
      </div>
    </div>
  )
}

export default React.memo(NoDataPlaceholder)
