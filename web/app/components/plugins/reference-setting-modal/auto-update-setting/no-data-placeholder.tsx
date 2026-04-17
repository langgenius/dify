'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SearchMenu } from '@/app/components/base/icons/src/vender/line/general'
import { Group } from '@/app/components/base/icons/src/vender/other'

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
        <div className="mt-2 system-sm-regular text-text-tertiary">{text}</div>
      </div>
    </div>
  )
}

export default React.memo(NoDataPlaceholder)
