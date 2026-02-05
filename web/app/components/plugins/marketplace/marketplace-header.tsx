'use client'

import { useMarketplaceSearchMode } from './atoms'
import { Description } from './description'
import SearchResultsHeader from './search-results-header'
import { useMarketplaceData } from './state'

type MarketplaceHeaderProps = {
  descriptionClassName?: string
  marketplaceNav?: React.ReactNode
}

const MarketplaceHeader = ({ descriptionClassName, marketplaceNav }: MarketplaceHeaderProps) => {
  const { creationType, isSearchMode: templatesSearchMode } = useMarketplaceData()
  const pluginsSearchMode = useMarketplaceSearchMode()

  // Use templates search mode when viewing templates, otherwise use plugins search mode
  const isSearchMode = creationType === 'templates' ? templatesSearchMode : pluginsSearchMode

  if (isSearchMode)
    return <SearchResultsHeader />

  return <Description className={descriptionClassName} marketplaceNav={marketplaceNav} />
}

export default MarketplaceHeader
