'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'

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
  const displayPlugins = isShowAll ? plugins.slice(0, MAX_DISPLAY_COUNT) : plugins
  return (
    <div className={cn('flex space-x-1', className)}>
      {displayPlugins.map((plugin, index) => (
        <div
          key={index}
          className='size-6 rounded-lg border-[0.5px] border-[components-panel-border-subtle] bg-background-default-dodge text-center text-xs leading-6 text-text-secondary'
        >
        </div>
      ))}
      {!isShowAll && <div>+{plugins.length - MAX_DISPLAY_COUNT}</div>}
    </div>
  )
}
export default React.memo(PluginsSelected)
