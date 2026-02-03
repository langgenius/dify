'use client'

import { cn } from '@/utils/classnames'
import SearchBoxWrapper from './search-box/search-box-wrapper'

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
      <SearchBoxWrapper />
    </div>
  )
}

export default StickySearchAndSwitchWrapper
