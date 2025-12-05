'use client'

import SearchBoxWrapper from './search-box/search-box-wrapper'
import PluginTypeSwitch from './plugin-type-switch'
import cn from '@/utils/classnames'

type StickySearchAndSwitchWrapperProps = {
  locale?: string
  pluginTypeSwitchClassName?: string
  showSearchParams?: boolean
}

const StickySearchAndSwitchWrapper = ({
  locale,
  pluginTypeSwitchClassName,
  showSearchParams,
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
      <SearchBoxWrapper locale={locale} />
      <PluginTypeSwitch
        locale={locale}
        showSearchParams={showSearchParams}
      />
    </div>
  )
}

export default StickySearchAndSwitchWrapper
