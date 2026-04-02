'use client'

import { useSearchTab } from './atoms'
import ListWrapper from './list/list-wrapper'
import SearchPage from './search-page'

type MarketplaceContentProps = {
  showInstallButton?: boolean
}

const MarketplaceContent = ({ showInstallButton }: MarketplaceContentProps) => {
  const [searchTab] = useSearchTab()

  if (searchTab)
    return <SearchPage />
  return <ListWrapper showInstallButton={showInstallButton} />
}

export default MarketplaceContent
