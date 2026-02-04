'use client'

import { useMarketplaceSearchMode } from './atoms'
import { Description } from './description'
import SearchResultsHeader from './search-results-header'

type MarketplaceHeaderProps = {
  descriptionClassName?: string
  marketplaceNav?: React.ReactNode
}

const MarketplaceHeader = ({ descriptionClassName, marketplaceNav }: MarketplaceHeaderProps) => {
  const isSearchMode = useMarketplaceSearchMode()

  if (isSearchMode)
    return <SearchResultsHeader />

  return <Description className={descriptionClassName} marketplaceNav={marketplaceNav} />
}

export default MarketplaceHeader
