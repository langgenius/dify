'use client'

import { useSearchTab } from './atoms'
import { Description } from './description'
import SearchResultsHeader from './search-results-header'

type MarketplaceHeaderProps = {
  descriptionClassName?: string
  marketplaceNav?: React.ReactNode
}

const MarketplaceHeader = ({ descriptionClassName, marketplaceNav }: MarketplaceHeaderProps) => {
  const [searchTab] = useSearchTab()

  if (searchTab)
    return <SearchResultsHeader marketplaceNav={marketplaceNav} />

  return <Description className={descriptionClassName} marketplaceNav={marketplaceNav} />
}

export default MarketplaceHeader
