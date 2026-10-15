'use client'

import { cn } from '@langgenius/dify-ui/cn'
import PluginTypeSwitch from './plugin-type-switch'
import { MarketplacePluginSearch } from './search-input'

type StickySearchAndSwitchWrapperProps = {
  pluginTypeSwitchClassName?: string
}

const StickySearchAndSwitchWrapper = ({
  pluginTypeSwitchClassName,
}: StickySearchAndSwitchWrapperProps) => {
  const hasCustomTopClass = pluginTypeSwitchClassName?.includes('top-')

  return (
    <div
      className={cn(
        'mt-4 bg-background-body',
        hasCustomTopClass && 'sticky z-10',
        pluginTypeSwitchClassName,
      )}
    >
      <div className="mx-auto w-160 max-w-full shrink-0">
        <MarketplacePluginSearch />
      </div>
      <PluginTypeSwitch />
    </div>
  )
}

export default StickySearchAndSwitchWrapper
