import type { SearchParams } from 'nuqs'
import Marketplace from '@/app/components/plugins/marketplace'

type MarketplacePageProps = {
  searchParams?: Promise<SearchParams>
}

const MarketplacePage = ({
  searchParams,
}: MarketplacePageProps) => {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background-body pt-8">
      <Marketplace searchParams={searchParams} />
    </div>
  )
}

export default MarketplacePage
