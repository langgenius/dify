'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SearchMenu } from '@/app/components/base/icons/src/vender/line/general'
import { Group } from '@/app/components/base/icons/src/vender/other'
import { cn } from '@/utils/classnames'

type Props = {
  className: string
  noPlugins?: boolean
}

const NoDataPlaceholder: FC<Props> = ({
  className,
  noPlugins,
}) => {
  const { t } = useTranslation()
  const icon = noPlugins ? (<Group className="size-6 text-text-quaternary" />) : (<SearchMenu className="size-8 text-text-tertiary" />)
  const text = t(`autoUpdate.noPluginPlaceholder.${noPlugins ? 'noInstalled' : 'noFound'}`, { ns: 'plugin' })
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div className="flex flex-col items-center">
        {icon}
        <div className="system-sm-regular mt-2 text-text-tertiary">{text}</div>
      </div>
    </div>
  )
}

export default React.memo(NoDataPlaceholder)
