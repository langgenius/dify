'use client'

import type { DehydratedState } from '@tanstack/react-query'
import { HydrationBoundary } from '@tanstack/react-query'
import { TanstackQueryInner } from '@/context/query-client'
import Description from './description'
import ListWrapper from './list/list-wrapper'
import StickySearchAndSwitchWrapper from './sticky-search-and-switch-wrapper'

export type MarketplaceClientProps = {
  showInstallButton?: boolean
  pluginTypeSwitchClassName?: string
  dehydratedState?: DehydratedState
}

export function MarketplaceClient({
  showInstallButton = true,
  pluginTypeSwitchClassName,
  dehydratedState,
}: MarketplaceClientProps) {
  return (
    <TanstackQueryInner>
      <HydrationBoundary state={dehydratedState}>
        <Description />
        <StickySearchAndSwitchWrapper
          pluginTypeSwitchClassName={pluginTypeSwitchClassName}
        />
        <ListWrapper showInstallButton={showInstallButton} />
      </HydrationBoundary>
    </TanstackQueryInner>
  )
}
