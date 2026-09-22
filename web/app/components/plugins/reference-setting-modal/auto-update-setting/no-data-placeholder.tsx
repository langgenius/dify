'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  className: string
  noPlugins?: boolean
}>

const NoDataPlaceholder: FC<Props> = ({ className, noPlugins }) => {
  const { t } = useTranslation()
  const icon = noPlugins ? (
    <span aria-hidden className="i-custom-vender-other-group size-6 text-text-quaternary" />
  ) : (
    <span
      aria-hidden
      className="i-custom-vender-line-general-search-menu size-8 text-text-tertiary"
    />
  )
  const text = t(
    ($) => $[`autoUpdate.noPluginPlaceholder.${noPlugins ? 'noInstalled' : 'noFound'}`],
    { ns: 'plugin' },
  )
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
