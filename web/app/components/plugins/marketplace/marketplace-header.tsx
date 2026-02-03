'use client'

import { useMarketplaceSearchMode } from './atoms'
import { Description } from './description'
import SearchResultsHeader from './search-results-header'

type MarketplaceHeaderProps = {
  descriptionClassName?: string
}

const MarketplaceHeader = ({ descriptionClassName }: MarketplaceHeaderProps) => {
  const isSearchMode = useMarketplaceSearchMode()

  if (isSearchMode)
    return <SearchResultsHeader />

  return <Description className={descriptionClassName} />
}

export default MarketplaceHeader
