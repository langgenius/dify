'use client'
import type { FC } from 'react'
import * as React from 'react'
import Icon from '@/app/components/plugins/card/base/card-icon'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { cn } from '@/utils/classnames'

const MAX_DISPLAY_COUNT = 14
type Props = {
  className?: string
  plugins: string[]
}

const PluginsSelected: FC<Props> = ({
  className,
  plugins,
}) => {
  const isShowAll = plugins.length < MAX_DISPLAY_COUNT
  const displayPlugins = plugins.slice(0, MAX_DISPLAY_COUNT)
  return (
    <div className={cn('flex items-center space-x-1', className)}>
      {displayPlugins.map(plugin => (
        <Icon key={plugin} size="tiny" src={`${MARKETPLACE_API_PREFIX}/plugins/${plugin}/icon`} />
      ))}
      {!isShowAll && (
        <div className="system-xs-medium text-text-tertiary">
          +
          {plugins.length - MAX_DISPLAY_COUNT}
        </div>
      )}
    </div>
  )
}
export default React.memo(PluginsSelected)
