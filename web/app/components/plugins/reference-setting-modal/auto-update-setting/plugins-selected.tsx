'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import Icon from '@/app/components/plugins/card/base/card-icon'
import { getMarketplacePluginIconUrl } from '@/features/marketplace/api'

const MAX_DISPLAY_COUNT = 14
type Props = Readonly<{
  className?: string
  plugins: string[]
}>

const PluginsSelected: FC<Props> = ({ className, plugins }) => {
  const displayPlugins = plugins.slice(0, MAX_DISPLAY_COUNT)
  const hiddenPluginsCount = plugins.length - displayPlugins.length
  return (
    <div className={cn('flex min-w-0 items-center overflow-hidden', className)}>
      {displayPlugins.map((plugin) => (
        <Icon key={plugin} size="tiny" src={getMarketplacePluginIconUrl(plugin)} />
      ))}
      {hiddenPluginsCount > 0 && (
        <div className="shrink-0 system-xs-medium text-text-tertiary">+{hiddenPluginsCount}</div>
      )}
    </div>
  )
}
export default React.memo(PluginsSelected)
